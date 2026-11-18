import { describe, expect, it, vi } from "vitest";
import { cleanupExpiredHistory, createApp, MemoryStorage, CONSENT_VERSION } from "./index.js";
import type { LiveKitGateway } from "./index.js";

const KEY = "k";
const AGENT = "agent-secret";
const CLEANUP = "cleanup-secret";
type J = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000;

function setup() {
  let t = Date.parse("2030-01-01T00:00:00Z");
  const storage = new MemoryStorage();
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD", created: true })),
    createToken: vi.fn(async (r) => `tok:${r.userId}`),
  };
  const app = createApp({
    storage,
    livekit,
    apiKeys: [KEY],
    agentSecret: AGENT,
    cleanupSecret: CLEANUP,
    now: () => new Date(t),
  });
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    bearer: string | null = KEY,
  ) => {
    const res = await app.request(path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as J };
  };
  const advance = (ms: number) => (t += ms);
  return { call, storage, advance, now: () => new Date(t) };
}

const payload = {
  participants: ["Dani", "Ana", "Mum"],
  transcript: [{ speaker: "Dani", text: "Hello", at: "2030-01-01T00:01:00Z" }],
  notes: ["Plan the trip"],
  actions: [{ text: "Book flights", owner: "Ana", done: false }],
  summary: "We planned a trip.",
  language: "en",
  actionLog: [{ text: "Created event", at: "2030-01-01T00:05:00Z" }],
};

/** A room with a host, a member, a removed-then-nobody stranger, and a guest who joined by invite. */
async function callWithHistory(s: ReturnType<typeof setup>, saveNotes = true) {
  const id = (
    await s.call("POST", "/v1/rooms", { hostUserId: "host", hostDisplayName: "Dani", agent: "on" })
  ).json.id as string;
  await s.call("POST", "/v1/tokens", { roomId: id, userId: "member", displayName: "Ana" });
  const inv = (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "host" })).json;
  await s.call(
    "POST",
    `/v1/invites/${inv.token}/join`,
    { displayName: "Mum", consent: { accepted: true, textVersion: CONSENT_VERSION } },
    null,
  );
  if (saveNotes) {
    await s.call("PUT", `/v1/rooms/${id}/history-settings`, { actorUserId: "host", saveNotes });
  }
  const saved = await s.call("POST", `/internal/rooms/${id}/history`, payload, AGENT);
  return { id, inv, saved };
}

describe("saving history", () => {
  it("stores nothing unless the host turned save notes on", async () => {
    const s = setup();
    const { id, saved } = await callWithHistory(s, false);
    expect(saved.json).toEqual({ saved: false });
    expect(await s.storage.getHistory(id)).toBeNull();
  });

  it("stores it when save notes is on, and the agent endpoint needs the agent secret", async () => {
    const s = setup();
    const { id, saved } = await callWithHistory(s);
    expect(saved.status).toBe(201);
    expect((await s.storage.getHistory(id))?.summary).toBe("We planned a trip.");
    expect((await s.call("POST", `/internal/rooms/${id}/history`, payload, KEY)).status).toBe(401);
    expect(
      (await s.call("POST", `/internal/rooms/${id}/history`, { ...payload, notes: "x" }, AGENT))
        .status,
    ).toBe(400);
  });

  it("only the host changes the settings and values are validated", async () => {
    const s = setup();
    const { id } = await callWithHistory(s, false);
    const put = (actorUserId: string, body: J) =>
      s.call("PUT", `/v1/rooms/${id}/history-settings`, { actorUserId, ...body });
    expect((await put("member", { saveNotes: true })).status).toBe(403);
    expect((await put("host", { retention: "5d" })).status).toBe(400);
    expect((await put("host", { saveNotes: true, retention: "1y" })).json).toEqual({
      saveNotes: true,
      retention: "1y",
    });
  });
});

describe("access rules", () => {
  it("host and participants read it; outsiders get 404", async () => {
    const s = setup();
    const { id } = await callWithHistory(s);
    for (const who of ["host", "member"]) {
      const r = await s.call("GET", `/v1/history/${id}?actorUserId=${who}`);
      expect(r.status).toBe(200);
      expect(r.json.transcript).toHaveLength(1);
      expect(r.json.retention).toBe("30d");
      const list = await s.call("GET", `/v1/history?actorUserId=${who}`);
      expect(list.json.calls.map((c: J) => c.roomId)).toEqual([id]);
      expect(list.json.calls[0].transcript).toBeUndefined();
    }
    expect((await s.call("GET", `/v1/history/${id}?actorUserId=stranger`)).status).toBe(404);
    expect((await s.call("GET", `/v1/history/${id}`)).status).toBe(400);
    expect(
      (await s.call("GET", `/v1/history/${id}?actorUserId=host`, undefined, null)).status,
    ).toBe(401);
    expect((await s.call("GET", `/v1/history?actorUserId=stranger`)).json.calls).toEqual([]);
  });

  it("a guest id cannot read through the user endpoint", async () => {
    const s = setup();
    const { id } = await callWithHistory(s);
    const [guest] = (await s.storage.listParticipants(id)).filter((p) => p.role === "guest");
    const r = await s.call("GET", `/v1/history/${id}?actorUserId=${guest!.userId}`);
    expect(r.status).toBe(404);
  });

  it("a guest reads through the invite token for 30 days, read-only", async () => {
    const s = setup();
    const { id, inv } = await callWithHistory(s);
    const get = (token: string) => s.call("GET", `/v1/invites/${token}/history`, undefined, null);
    const ok = await get(inv.token);
    expect(ok.status).toBe(200);
    expect(ok.json.summary).toBe("We planned a trip.");
    expect(JSON.stringify(ok.json)).not.toContain("contact");
    expect((await get("nope")).status).toBe(404);
    s.advance(31 * DAY);
    expect((await get(inv.token)).status).toBe(404);
    // Invite revoked: no access either.
    const s2 = setup();
    const c2 = await callWithHistory(s2);
    await s2.call("DELETE", `/v1/rooms/${c2.id}/invites/${c2.inv.id}?actorUserId=host`);
    expect(
      (await s2.call("GET", `/v1/invites/${c2.inv.token}/history`, undefined, null)).status,
    ).toBe(404);
    expect(id).toBeTruthy();
  });

  it("an invite that nobody used gives no access", async () => {
    const s = setup();
    const { id } = await callWithHistory(s);
    const spare = (await s.call("POST", `/v1/rooms/${id}/invites`, { actorUserId: "host" })).json;
    // Uses are per invite, so the spare one was never used.
    expect(
      (await s.call("GET", `/v1/invites/${spare.token}/history`, undefined, null)).status,
    ).toBe(404);
  });
});

describe("delete and retention", () => {
  it("host deletes everything for the call; others cannot", async () => {
    const s = setup();
    const { id, inv } = await callWithHistory(s);
    await s.storage.saveSummary({
      roomId: id,
      language: "en",
      text: "s",
      notes: [],
      actions: [],
      participants: [],
      createdAt: "2030-01-01T00:00:00Z",
    });
    expect((await s.call("DELETE", `/v1/history/${id}?actorUserId=member`)).status).toBe(403);
    expect(await s.storage.getHistory(id)).not.toBeNull();
    const del = await s.call("DELETE", `/v1/history/${id}?actorUserId=host`);
    expect(del.json).toMatchObject({ deleted: true, existed: true });
    expect(await s.storage.getHistory(id)).toBeNull();
    expect(await s.storage.getSummary(id)).toBeNull();
    expect((await s.call("GET", `/v1/history/${id}?actorUserId=host`)).status).toBe(404);
    expect((await s.call("GET", `/v1/invites/${inv.token}/history`, undefined, null)).status).toBe(
      404,
    );
  });

  it("cleanup removes history past retention only, and is protected", async () => {
    const s = setup();
    const a = await callWithHistory(s); // 30d default
    const b = await callWithHistory(s);
    await s.call("PUT", `/v1/rooms/${b.id}/history-settings`, {
      actorUserId: "host",
      retention: "1y",
    });
    const c = await callWithHistory(s);
    await s.call("PUT", `/v1/rooms/${c.id}/history-settings`, {
      actorUserId: "host",
      retention: "forever",
    });
    const run = (bearer: string | null) =>
      s.call("POST", "/internal/history/cleanup", undefined, bearer);
    expect((await run(null)).status).toBe(401);
    expect((await run(KEY)).status).toBe(401);
    expect((await run(AGENT)).status).toBe(401);
    s.advance(10 * DAY);
    expect((await run(CLEANUP)).json).toEqual({ removed: 0 });
    s.advance(25 * DAY);
    expect((await run(CLEANUP)).json).toEqual({ removed: 1 });
    expect(await s.storage.getHistory(a.id)).toBeNull();
    expect(await s.storage.getHistory(b.id)).not.toBeNull();
    s.advance(400 * DAY);
    expect(await cleanupExpiredHistory(s.storage, s.now())).toEqual([b.id]);
    expect(await s.storage.getHistory(c.id)).not.toBeNull();
  });

  it("cleanup is off without a secret", async () => {
    const app = createApp({
      storage: new MemoryStorage(),
      livekit: {} as LiveKitGateway,
      apiKeys: [KEY],
    });
    const res = await app.request("/internal/history/cleanup", { method: "POST" });
    expect(res.status).toBe(401);
  });
});
