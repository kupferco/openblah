import { describe, expect, it, vi } from "vitest";
import { CONSENT_VERSION, createApp, MemoryStorage } from "./index.js";
import type { LiveKitGateway } from "./index.js";

const KEY = "k";
const SECRET = "agent-secret";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup() {
  let t = Date.parse("2030-01-01T00:00:00Z");
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    stopAgent: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    createToken: vi.fn(async (r) => `tok:${r.userId}`),
  };
  const app = createApp({
    storage: new MemoryStorage(),
    livekit,
    apiKeys: [KEY],
    agentSecret: SECRET,
    now: () => new Date(t),
  });
  const call = async (method: string, path: string, body?: unknown, bearer = KEY) => {
    const res = await app.request(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as J };
  };
  const advance = (ms: number) => (t += ms);
  const lastMetadata = () => {
    const calls = vi.mocked(livekit.updateRoomMetadata).mock.calls;
    return JSON.parse(calls[calls.length - 1]![1]) as J;
  };
  return { call, livekit, advance, lastMetadata };
}
type S = ReturnType<typeof setup>;

async function room(s: S, extra: J = {}) {
  const r = await s.call("POST", "/v1/rooms", {
    hostUserId: "host",
    hostDisplayName: "Dani",
    ...extra,
  });
  const id = r.json.id as string;
  await s.call("POST", "/v1/tokens", { roomId: id, userId: "m1", displayName: "Maria" });
  return id;
}
const consent = (s: S, id: string, userId: string) =>
  s.call("POST", `/v1/rooms/${id}/consent`, {
    userId,
    accepted: true,
    textVersion: CONSENT_VERSION,
  });

describe("agent off: a plain call", () => {
  it("defaults to ask, which is off until someone invites the agent", async () => {
    const s = setup();
    const r = await s.call("POST", "/v1/rooms", { hostUserId: "host", hostDisplayName: "Dani" });
    expect(r.json.agent).toBe("ask");
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
  });

  it("never dispatches the worker (so no STT, LLM or TTS) while off", async () => {
    const s = setup();
    const id = await room(s, { agent: "off" });
    expect((await s.call("POST", `/v1/rooms/${id}/agent`, {})).status).toBe(409);
    expect(
      (await s.call("POST", `/v1/rooms/${id}/agent/dispatch`, { actorUserId: "host" })).status,
    ).toBe(409);
    // Joining, tokens and invites need no consent and no agent.
    expect(
      (await s.call("POST", "/v1/tokens", { roomId: id, userId: "m2", displayName: "X" })).status,
    ).toBe(200);
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
  });

  it("lets a guest join an ask room without consent", async () => {
    const s = setup();
    const id = await room(s);
    const inv = (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "host" })).json;
    const res = await s.call("POST", `/v1/invites/${inv.token}/join`, { displayName: "Mum" });
    expect(res.status).toBe(200);
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
  });
});

describe("who can bring the agent in", () => {
  it("host only by default: a member's request waits for approval", async () => {
    const s = setup();
    const id = await room(s);
    const r = await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "m1" });
    expect(r.status).toBe(202);
    expect(r.json.status).toBe("requested");
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
    expect(s.lastMetadata().agent).toBe("ask");
    expect(s.lastMetadata().agentRequests).toHaveLength(1);
    // Asking twice leaves one request.
    await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "m1" });
    expect(s.lastMetadata().agentRequests).toHaveLength(1);
  });

  it("only the host sees and answers requests", async () => {
    const s = setup();
    const id = await room(s);
    await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "m1" });
    const asHost = await s.call("GET", `/v1/rooms/${id}/agent?actorUserId=host`);
    const asMember = await s.call("GET", `/v1/rooms/${id}/agent?actorUserId=m1`);
    expect(asHost.json.requests).toHaveLength(1);
    expect(asMember.json.requests).toEqual([]);
    const reqId = asHost.json.requests[0].id;
    const path = `/v1/rooms/${id}/agent/requests/${reqId}`;
    expect((await s.call("POST", `${path}/approve`, { actorUserId: "m1" })).status).toBe(403);
    expect((await s.call("POST", `${path}/decline`, { actorUserId: "host" })).status).toBe(200);
    expect(s.lastMetadata().agentRequests).toEqual([]);
    expect(s.lastMetadata().agent).toBe("ask");
  });

  it("approving a request brings the agent in, after consent", async () => {
    const s = setup();
    const id = await room(s);
    await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "m1" });
    const reqId = (await s.call("GET", `/v1/rooms/${id}/agent?actorUserId=host`)).json.requests[0]
      .id;
    const a = await s.call("POST", `/v1/rooms/${id}/agent/requests/${reqId}/approve`, {
      actorUserId: "host",
    });
    expect(a.json.status).toBe("awaiting_consent");
    expect(s.lastMetadata()).toMatchObject({ agent: "on", agentRequests: [] });
  });

  it("with 'anyone can add the agent' any participant brings it in and sends it out", async () => {
    const s = setup();
    const id = await room(s, { anyoneCanAddAgent: true });
    await consent(s, id, "host");
    await consent(s, id, "m1");
    const r = await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "m1" });
    expect(r.json.status).toBe("on");
    expect(s.livekit.dispatchAgent).toHaveBeenCalledTimes(1);
    const out = await s.call("POST", `/v1/rooms/${id}/agent/send-out`, { actorUserId: "m1" });
    expect(out.status).toBe(200);
    expect(s.livekit.stopAgent).toHaveBeenCalledWith(id);
  });

  it("members cannot send the agent out unless the setting is on; strangers cannot do anything", async () => {
    const s = setup();
    const id = await room(s, { agent: "on" });
    expect(
      (await s.call("POST", `/v1/rooms/${id}/agent/send-out`, { actorUserId: "m1" })).status,
    ).toBe(403);
    expect(
      (await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "stranger" })).status,
    ).toBe(403);
    expect(s.livekit.stopAgent).not.toHaveBeenCalled();
  });

  it("the host turns the setting on and the idle timeout is validated", async () => {
    const s = setup();
    const id = await room(s);
    const bad = await s.call("PUT", `/v1/rooms/${id}/agent`, {
      actorUserId: "host",
      idleTimeoutSeconds: 0,
    });
    expect(bad.status).toBe(400);
    const ok = await s.call("PUT", `/v1/rooms/${id}/agent`, {
      actorUserId: "host",
      anyoneCanAddAgent: true,
      idleTimeoutSeconds: 120,
    });
    expect(ok.json).toMatchObject({ anyoneCanAddAgent: true, idleTimeoutSeconds: 120 });
    const state = await s.call("GET", `/v1/rooms/${id}/agent?actorUserId=m1`);
    expect(state.json).toMatchObject({ idleTimeoutSeconds: 120, canControl: true });
    const notHost = await s.call("PUT", `/v1/rooms/${id}/agent`, {
      actorUserId: "m1",
      anyoneCanAddAgent: false,
    });
    expect(notHost.status).toBe(403);
  });
});

describe("late consent", () => {
  it("asks everyone again when the agent is brought in, and starts only when all agree", async () => {
    const s = setup();
    const id = await room(s);
    // Consent given while the agent was off does not count once it is brought in.
    await consent(s, id, "host");
    await consent(s, id, "m1");
    s.advance(1000);
    const r = await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "host" });
    expect(r.json.status).toBe("awaiting_consent");
    expect(r.json.missing.map((m: J) => m.userId).sort()).toEqual(["host", "m1"]);
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
    expect(s.lastMetadata().agentAwaitingConsent).toBe(true);

    s.advance(1000);
    await consent(s, id, "host");
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
    const state = await s.call("GET", `/v1/rooms/${id}/agent?actorUserId=host`);
    expect(state.json.missing.map((m: J) => m.userId)).toEqual(["m1"]);
    // The consent line is the T10 one.
    const text = await s.call("GET", `/v1/rooms/${id}/consent?userId=m1`);
    expect(text.json.text).toContain("Blah");

    await consent(s, id, "m1");
    expect(s.livekit.dispatchAgent).toHaveBeenCalledTimes(1);
    expect(s.lastMetadata().agentAwaitingConsent).toBe(false);
  });

  it("the host can keep the agent off while consent is missing", async () => {
    const s = setup();
    const id = await room(s);
    await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "host" });
    const off = await s.call("PUT", `/v1/rooms/${id}/agent`, { actorUserId: "host", agent: "off" });
    expect(off.json.agent).toBe("off");
    await consent(s, id, "host");
    await consent(s, id, "m1");
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
    expect(s.livekit.stopAgent).toHaveBeenCalled();
  });

  it("a person who joins while the agent is on must consent before it listens to them", async () => {
    const s = setup();
    const id = await room(s);
    await s.call("POST", `/v1/rooms/${id}/agent/bring-in`, { actorUserId: "host" });
    await consent(s, id, "host");
    await consent(s, id, "m1");
    await s.call("POST", "/v1/tokens", { roomId: id, userId: "m2", displayName: "Late" });
    const c = await s.call("GET", `/v1/rooms/${id}/consent?userId=m2`);
    expect(c.json.missing.map((m: J) => m.userId)).toEqual(["m2"]);
  });
});

describe("leaving", () => {
  it("send-out stops the agent and returns the room to off", async () => {
    const s = setup();
    const id = await room(s, { agent: "on" });
    const r = await s.call("POST", `/v1/rooms/${id}/agent/send-out`, { actorUserId: "host" });
    expect(r.json.agent).toBe("off");
    expect(s.livekit.stopAgent).toHaveBeenCalledWith(id);
    expect(s.lastMetadata().agent).toBe("off");
  });

  it("a voice request to leave, relayed by the agent worker, turns the room off", async () => {
    const s = setup();
    const id = await room(s, { agent: "on" });
    const denied = await s.call("POST", `/internal/rooms/${id}/agent-off`, {}, "wrong");
    expect(denied.status).toBe(401);
    const r = await s.call("POST", `/internal/rooms/${id}/agent-off`, {}, SECRET);
    expect(r.status).toBe(200);
    expect(s.lastMetadata().agent).toBe("off");
  });
});
