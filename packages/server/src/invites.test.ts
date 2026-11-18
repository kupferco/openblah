import { describe, expect, it, vi } from "vitest";
import {
  CONSENT_VERSION,
  createApp,
  grantsFor,
  MemoryStorage,
  renderConsentText,
} from "./index.js";
import type { LiveKitGateway, TokenRequest } from "./index.js";

const KEY = "k";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function setup(opts: { max?: number } = {}) {
  let t = Date.parse("2030-01-01T00:00:00Z");
  const tokens: TokenRequest[] = [];
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    stopAgent: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    createToken: vi.fn(async (r) => {
      tokens.push(r);
      return `tok:${r.userId}:${r.role}`;
    }),
  };
  const app = createApp({
    storage: new MemoryStorage(),
    livekit,
    apiKeys: [KEY],
    now: () => new Date(t),
    livekitUrl: "wss://lk.example",
    joinRateLimit: { max: opts.max ?? 100, windowMs: 60_000 },
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    auth = true,
    ip = "1.1.1.1",
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        ...(auth ? { Authorization: `Bearer ${KEY}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as J, res };
  };
  const advance = (ms: number) => (t += ms);
  return { call, livekit, tokens, advance };
}

async function room(s: ReturnType<typeof setup>, agent = "on") {
  const r = await s.call("POST", "/v1/rooms", {
    hostUserId: "host",
    hostDisplayName: "Dani",
    agent,
  });
  return r.json.id as string;
}
const invite = async (s: ReturnType<typeof setup>, id: string, extra: J = {}) =>
  (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "host", ...extra })).json;
const join = (s: ReturnType<typeof setup>, token: string, body: J, ip?: string) =>
  s.call("POST", `/v1/invites/${token}/join`, body, false, ip);
const consent = { accepted: true, textVersion: CONSENT_VERSION };

describe("invites", () => {
  it("host creates an invite with the default link format and 24h expiry", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id);
    expect(inv.url).toBe(`https://openblah.web.app/j/${inv.token}`);
    expect(inv.maxUses).toBe(1);
    expect(Date.parse(inv.expiresAt) - Date.parse("2030-01-01T00:00:00Z")).toBe(86_400_000);
  });

  it("only the host can create or revoke invites", async () => {
    const s = setup();
    const id = await room(s);
    await s.call("POST", "/v1/tokens", { roomId: id, userId: "m1", displayName: "M" });
    expect((await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "m1" })).status).toBe(
      403,
    );
    expect(
      (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "nobody" })).status,
    ).toBe(403);
    expect((await s.call("POST", `/v1/rooms/${id}/invites`, {})).status).toBe(400);
    const inv = await invite(s, id);
    expect(
      (await s.call("DELETE", `/v1/rooms/${id}/invites/${inv.id}?actorUserId=m1`)).status,
    ).toBe(403);
  });

  it("guest joins with consent and gets a guest token", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id);
    const res = await join(s, inv.token, { displayName: "Mum", consent });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ roomId: id, role: "guest", livekitUrl: "wss://lk.example" });
    expect(res.json.userId).toMatch(/^guest_/);
    expect(s.tokens.at(-1)).toMatchObject({ role: "guest", isHost: false });
    expect(res.res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("requires consent while the agent is on, not while it is off", async () => {
    const s = setup();
    const on = await room(s, "on");
    const inv = await invite(s, on, { maxUses: 5 });
    expect((await join(s, inv.token, { displayName: "A" })).status).toBe(400);
    expect(
      (
        await join(s, inv.token, {
          displayName: "A",
          consent: { accepted: false, textVersion: CONSENT_VERSION },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await join(s, inv.token, {
          displayName: "A",
          consent: { accepted: true, textVersion: "0" },
        })
      ).status,
    ).toBe(400);
    // failed attempts did not use up the invite
    expect((await join(s, inv.token, { displayName: "A", consent })).status).toBe(200);
    const off = await room(s, "off");
    const inv2 = await invite(s, off);
    expect((await join(s, inv2.token, { displayName: "B" })).status).toBe(200);
  });

  it("single use by default, limited use when asked", async () => {
    const s = setup();
    const id = await room(s);
    const one = await invite(s, id);
    expect((await join(s, one.token, { displayName: "A", consent })).status).toBe(200);
    expect((await join(s, one.token, { displayName: "B", consent })).status).toBe(404);
    const three = await invite(s, id, { maxUses: 3 });
    for (let i = 0; i < 3; i++) {
      expect((await join(s, three.token, { displayName: `G${i}`, consent })).status).toBe(200);
    }
    expect((await join(s, three.token, { displayName: "G4", consent })).status).toBe(404);
  });

  it("expires", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id, { expiresInSeconds: 3600 });
    s.advance(3600_000 - 1);
    expect((await s.call("GET", `/v1/invites/${inv.token}`, undefined, false)).status).toBe(200);
    s.advance(1);
    expect((await join(s, inv.token, { displayName: "A", consent })).status).toBe(404);
    expect((await s.call("GET", `/v1/invites/${inv.token}`, undefined, false)).status).toBe(404);
  });

  it("host can revoke", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id, { maxUses: 5 });
    const del = await s.call("DELETE", `/v1/rooms/${id}/invites/${inv.id}?actorUserId=host`);
    expect(del.status).toBe(200);
    expect((await join(s, inv.token, { displayName: "A", consent })).status).toBe(404);
    expect((await s.call("DELETE", `/v1/rooms/${id}/invites/nope?actorUserId=host`)).status).toBe(
      404,
    );
  });

  it("rejects unknown tokens and ended rooms alike", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id);
    expect((await join(s, "bogus", { displayName: "A", consent })).status).toBe(404);
    await s.call("POST", `/v1/rooms/${id}/end`, { actorUserId: "host" });
    expect((await join(s, inv.token, { displayName: "A", consent })).status).toBe(404);
  });

  it("validates ttl and uses", async () => {
    const s = setup();
    const id = await room(s);
    for (const bad of [
      { expiresInSeconds: 1 },
      { maxUses: 0 },
      { maxUses: 1.5 },
      { maxUses: 1000 },
    ]) {
      expect(
        (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "host", ...bad })).status,
      ).toBe(400);
    }
  });

  it("rate limits the public join endpoint per client and per token", async () => {
    const s = setup({ max: 3 });
    const id = await room(s);
    const inv = await invite(s, id, { maxUses: 50 });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push((await join(s, "guess" + i, { displayName: "A", consent })).status);
    expect(codes).toEqual([404, 404, 404, 429, 429]);
    // another client is not blocked by the first one's counter
    expect((await join(s, inv.token, { displayName: "A", consent }, "9.9.9.9")).status).toBe(200);
    // the window resets
    s.advance(60_000);
    expect((await join(s, "again", { displayName: "A", consent })).status).toBe(404);
  });

  it("does not need the API key for join, but needs it elsewhere", async () => {
    const s = setup();
    const id = await room(s);
    expect(
      (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "host" }, false)).status,
    ).toBe(401);
  });

  it("previews the invite with consent text and no room id", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id);
    const r = await s.call("GET", `/v1/invites/${inv.token}`, undefined, false);
    expect(r.json.consent.version).toBe(CONSENT_VERSION);
    expect(r.json.consent.text).toContain("Blah");
    expect(JSON.stringify(r.json)).not.toContain(id);
  });
});

describe("consent", () => {
  it("text includes agent name and processors placeholder", () => {
    expect(renderConsentText("Zed")).toContain("Zed");
    expect(renderConsentText("Zed")).toContain("processors");
    expect(renderConsentText("Zed", "A, B")).toContain("A, B");
  });

  it("uses a per-room agent name", async () => {
    const s = setup();
    const r = await s.call("POST", "/v1/rooms", {
      hostUserId: "h",
      hostDisplayName: "H",
      agentName: "Zed",
    });
    const c = await s.call("GET", `/v1/rooms/${r.json.id}/consent?userId=h`);
    expect(c.json.text).toContain("Zed");
  });

  it("refuses to dispatch until every participant consented", async () => {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id);
    await s.call("POST", "/v1/tokens", { roomId: id, userId: "m1", displayName: "M" });
    const g = await join(s, inv.token, { displayName: "Mum", consent });
    const d = () => s.call("POST", `/v1/rooms/${id}/agent/dispatch`, { actorUserId: "host" });
    let res = await d();
    expect(res.status).toBe(409);
    expect(res.json.missing.map((m: J) => m.userId).sort()).toEqual(["host", "m1"]);
    expect(s.livekit.dispatchAgent).not.toHaveBeenCalled();
    for (const u of ["host", "m1"]) {
      const c = await s.call("POST", `/v1/rooms/${id}/consent`, {
        userId: u,
        accepted: true,
        textVersion: CONSENT_VERSION,
      });
      expect(c.status).toBe(200);
    }
    res = await d();
    expect(res.status).toBe(200);
    expect(s.livekit.dispatchAgent).toHaveBeenCalledWith(id, expect.any(String));
    expect(g.status).toBe(200);
  });

  it("a participant who joined an AI-off room must consent when the agent comes in", async () => {
    const s = setup();
    const id = await room(s, "ask");
    await s.call("POST", "/v1/tokens", { roomId: id, userId: "m1", displayName: "M" });
    const r = await s.call("POST", `/v1/rooms/${id}/agent/dispatch`, { actorUserId: "host" });
    expect(r.status).toBe(409);
  });

  it("host can override to AI off, which blocks dispatch", async () => {
    const s = setup();
    const id = await room(s);
    const set = await s.call("PUT", `/v1/rooms/${id}/agent`, { actorUserId: "host", agent: "off" });
    expect(set.status).toBe(200);
    expect(s.livekit.updateRoomMetadata).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(s.livekit.updateRoomMetadata).mock.calls[0]![1])).toMatchObject({
      agent: "off",
    });
    expect(
      (await s.call("POST", `/v1/rooms/${id}/agent/dispatch`, { actorUserId: "host" })).status,
    ).toBe(409);
  });

  it("rejects stale versions, non-participants and non-hosts dispatching", async () => {
    const s = setup();
    const id = await room(s);
    expect(
      (
        await s.call("POST", `/v1/rooms/${id}/consent`, {
          userId: "host",
          accepted: true,
          textVersion: "0",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await s.call("POST", `/v1/rooms/${id}/consent`, {
          userId: "stranger",
          accepted: true,
          textVersion: CONSENT_VERSION,
        })
      ).status,
    ).toBe(403);
    await s.call("POST", "/v1/tokens", { roomId: id, userId: "m1", displayName: "M" });
    expect(
      (await s.call("POST", `/v1/rooms/${id}/agent/dispatch`, { actorUserId: "m1" })).status,
    ).toBe(403);
  });
});

describe("guest rights and host controls", () => {
  async function withGuest() {
    const s = setup();
    const id = await room(s);
    const inv = await invite(s, id, { maxUses: 3 });
    const g = await join(s, inv.token, { displayName: "Mum", consent });
    await s.call("POST", "/v1/tokens", {
      roomId: id,
      userId: "m1",
      displayName: "Max",
      contact: "max@example.com",
    });
    return { s, id, gid: g.json.userId as string, inv };
  }

  it("guest token grants have no admin or metadata rights", () => {
    expect(grantsFor("guest", "r")).toMatchObject({
      roomAdmin: false,
      canUpdateOwnMetadata: false,
      roomRecord: false,
    });
    expect(grantsFor("member", "r").roomAdmin).toBe(false);
    expect(grantsFor("host", "r").roomAdmin).toBe(true);
  });

  it("guest cannot change agent mode, invite, end, remove, approve, or invoke tools", async () => {
    const { s, id, gid } = await withGuest();
    expect(
      (await s.call("PUT", `/v1/rooms/${id}/agent`, { actorUserId: gid, agent: "off" })).status,
    ).toBe(403);
    expect((await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: gid })).status).toBe(
      403,
    );
    expect((await s.call("POST", `/v1/rooms/${id}/end`, { actorUserId: gid })).status).toBe(403);
    expect(
      (await s.call("DELETE", `/v1/rooms/${id}/participants/m1?actorUserId=${gid}`)).status,
    ).toBe(403);
    expect(
      (await s.call("POST", `/v1/rooms/${id}/approvals/a1`, { actorUserId: gid })).status,
    ).toBe(403);
    const p = await s.call("GET", `/v1/rooms/${id}/permissions?userId=${gid}`);
    expect(p.json).toMatchObject({
      role: "guest",
      canInvokeTools: false,
      canChangeAgentMode: false,
      canSeeContacts: false,
    });
    const h = await s.call("GET", `/v1/rooms/${id}/permissions?userId=host`);
    expect(h.json).toMatchObject({ role: "host", canInvokeTools: true, canChangeAgentMode: true });
    const m = await s.call("GET", `/v1/rooms/${id}/permissions?userId=m1`);
    expect(m.json).toMatchObject({
      role: "member",
      canInvokeTools: true,
      canChangeAgentMode: false,
    });
  });

  it("a members cannot change agent mode either", async () => {
    const { s, id } = await withGuest();
    expect(
      (await s.call("PUT", `/v1/rooms/${id}/agent`, { actorUserId: "m1", agent: "off" })).status,
    ).toBe(403);
  });

  it("guest cannot see contact details; members can", async () => {
    const { s, id, gid } = await withGuest();
    const asGuest = await s.call("GET", `/v1/rooms/${id}/participants?viewerUserId=${gid}`);
    expect(JSON.stringify(asGuest.json)).not.toContain("max@example.com");
    expect(asGuest.json.participants).toHaveLength(3);
    const asMember = await s.call("GET", `/v1/rooms/${id}/participants?viewerUserId=m1`);
    expect(JSON.stringify(asMember.json)).toContain("max@example.com");
    expect((await s.call("GET", `/v1/rooms/${id}/participants?viewerUserId=x`)).status).toBe(403);
  });

  it("a guest id cannot be reused to get a member token", async () => {
    const { s, id, gid } = await withGuest();
    expect(
      (await s.call("POST", "/v1/tokens", { roomId: id, userId: gid, displayName: "x" })).status,
    ).toBe(403);
  });

  it("host removes a participant, who cannot get a new token", async () => {
    const { s, id, gid } = await withGuest();
    const r = await s.call("DELETE", `/v1/rooms/${id}/participants/${gid}?actorUserId=host`);
    expect(r.status).toBe(200);
    expect(s.livekit.removeParticipant).toHaveBeenCalledWith(id, gid);
    expect((await s.call("GET", `/v1/rooms/${id}/permissions?userId=${gid}`)).status).toBe(403);
    expect(
      (await s.call("DELETE", `/v1/rooms/${id}/participants/host?actorUserId=host`)).status,
    ).toBe(400);
    await s.call("DELETE", `/v1/rooms/${id}/participants/m1?actorUserId=host`);
    expect(
      (await s.call("POST", "/v1/tokens", { roomId: id, userId: "m1", displayName: "Max" })).status,
    ).toBe(403);
  });

  it("host ends the room; tokens are refused afterwards", async () => {
    const { s, id } = await withGuest();
    expect((await s.call("POST", `/v1/rooms/${id}/end`, { actorUserId: "host" })).status).toBe(200);
    expect(s.livekit.deleteRoom).toHaveBeenCalledWith(id);
    expect(
      (await s.call("POST", "/v1/tokens", { roomId: id, userId: "host", displayName: "D" })).status,
    ).toBe(409);
    expect((await s.call("POST", `/v1/rooms/${id}/end`, { actorUserId: "host" })).status).toBe(200);
    expect(s.livekit.deleteRoom).toHaveBeenCalledOnce();
  });

  it("approval endpoint forwards only the tool owner's decision to the agent", async () => {
    const { s, id, gid } = await withGuest();
    const post = (actorUserId: string, extra: object = { approve: true }) =>
      s.call("POST", `/v1/rooms/${id}/approvals/a1`, { actorUserId, ...extra });
    expect((await post("host")).status).toBe(202);
    expect(s.livekit.sendData).toHaveBeenCalledWith(
      id,
      "openblah.approval.decision",
      JSON.stringify({ approvalId: "a1", approve: true, actorUserId: "host" }),
    );
    expect((await post("host", {})).status).toBe(400);
    // A guest and an unrelated stranger are rejected and nothing is sent.
    vi.mocked(s.livekit.sendData).mockClear();
    expect((await post(gid)).status).toBe(403);
    expect((await post("stranger")).status).toBe(403);
    expect(s.livekit.sendData).not.toHaveBeenCalled();
  });
});
