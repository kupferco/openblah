import { describe, expect, it, vi } from "vitest";
import { createApp, isValidApiKey, MemoryStorage, parseApiKeys } from "./index.js";
import type { LiveKitGateway } from "./index.js";

type Json = Record<string, string>;
const KEY = "test-key-1";

function setup() {
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async (r) => `tok:${r.roomId}:${r.userId}:${r.isHost}`),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
  };
  let t = 1_000_000;
  const worker = { wake: vi.fn(async () => true) };
  const app = createApp({
    storage: new MemoryStorage(),
    livekit,
    apiKeys: [KEY, "other"],
    worker,
    nowMs: () => t,
  });
  const advance = (ms: number) => (t += ms);
  const call = (method: string, path: string, body?: unknown, key: string | null = KEY) =>
    app.request(path, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { livekit, call, worker, advance };
}

const host = { hostUserId: "u1", hostDisplayName: "Dani" };

describe("auth", () => {
  it("compares keys", () => {
    expect(isValidApiKey("a", ["a", "b"])).toBe(true);
    expect(isValidApiKey("c", ["a", "b"])).toBe(false);
    expect(parseApiKeys(" a, b ,,")).toEqual(["a", "b"]);
  });

  it("health needs no key", async () => {
    const { call } = setup();
    expect((await call("GET", "/health", undefined, null)).status).toBe(200);
  });

  it("rejects missing and wrong keys on every v1 route", async () => {
    const { call, livekit } = setup();
    for (const key of [null, "wrong"]) {
      expect((await call("POST", "/v1/rooms", host, key)).status).toBe(401);
      expect((await call("GET", "/v1/rooms/x", undefined, key)).status).toBe(401);
      expect((await call("POST", "/v1/tokens", {}, key)).status).toBe(401);
      expect((await call("POST", "/v1/rooms/x/agent", {}, key)).status).toBe(401);
      expect((await call("POST", "/v1/warmup", { userId: "u" }, key)).status).toBe(401);
    }
    expect(livekit.createRoom).not.toHaveBeenCalled();
  });
});

describe("rooms", () => {
  it("creates and gets a room, mirroring metadata to LiveKit", async () => {
    const { call, livekit } = setup();
    const res = await call("POST", "/v1/rooms", {
      ...host,
      sensitive: true,
      metadata: { app: "x" },
    });
    expect(res.status).toBe(201);
    const room = (await res.json()) as Json;
    expect(room).toMatchObject({
      hostUserId: "u1",
      agent: "ask",
      sensitive: true,
      metadata: { app: "x" },
    });
    expect(room.id).toMatch(/^rm_[\w-]{16}$/);
    expect(livekit.createRoom).toHaveBeenCalledOnce();
    const [id, meta] = vi.mocked(livekit.createRoom).mock.calls[0]!;
    expect(id).toBe(room.id);
    expect(JSON.parse(meta)).toMatchObject({ agent: "ask", hostDisplayName: "Dani" });

    const got = await call("GET", `/v1/rooms/${room.id}`);
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual(room);
  });

  it("gives each room a unique id", async () => {
    const { call } = setup();
    const a = (await (await call("POST", "/v1/rooms", host)).json()) as Json;
    const b = (await (await call("POST", "/v1/rooms", host)).json()) as Json;
    expect(a.id).not.toBe(b.id);
  });

  it("returns 404 for unknown rooms", async () => {
    const { call } = setup();
    expect((await call("GET", "/v1/rooms/nope")).status).toBe(404);
  });

  it("validates input", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/rooms", { hostUserId: "u" })).status).toBe(400);
    expect((await call("POST", "/v1/rooms", { ...host, agent: "maybe" })).status).toBe(400);
    expect((await call("POST", "/v1/rooms", { ...host, sensitive: "yes" })).status).toBe(400);
    expect((await call("POST", "/v1/rooms", { ...host, metadata: [] })).status).toBe(400);
  });
});

describe("tokens", () => {
  it("mints a token for an existing room", async () => {
    const { call, livekit } = setup();
    const room = (await (await call("POST", "/v1/rooms", host)).json()) as Json;
    const res = await call("POST", "/v1/tokens", {
      roomId: room.id,
      userId: "u2",
      displayName: "Guest",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      token: `tok:${room.id}:u2:false`,
      roomId: room.id,
      expiresIn: 600,
    });
    const host2 = await call("POST", "/v1/tokens", {
      roomId: room.id,
      userId: "u1",
      displayName: "Dani",
    });
    expect(((await host2.json()) as Json).token).toBe(`tok:${room.id}:u1:true`);
    expect(livekit.createToken).toHaveBeenCalledTimes(2);
  });

  it("404 for unknown room, 400 for bad input", async () => {
    const { call } = setup();
    expect(
      (await call("POST", "/v1/tokens", { roomId: "x", userId: "u", displayName: "n" })).status,
    ).toBe(404);
    expect((await call("POST", "/v1/tokens", { roomId: "x" })).status).toBe(400);
  });

  it("hides internal errors", async () => {
    const { call, livekit } = setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(livekit.createRoom).mockRejectedValueOnce(new Error("secret-detail"));
    const res = await call("POST", "/v1/rooms", host);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret-detail");
  });
});

describe("agent dispatch", () => {
  it("dispatches the agent into an existing room", async () => {
    const { call, livekit } = setup();
    const room = (await (await call("POST", "/v1/rooms", host)).json()) as { id: string };
    const res = await call("POST", `/v1/rooms/${room.id}/agent`);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ roomId: room.id, dispatchId: "AD_1", created: true });
    expect(livekit.dispatchAgent).toHaveBeenCalledWith(room.id, expect.any(String));
  });

  it("passes MCP config to the agent only, never to clients", async () => {
    const { call, livekit } = setup();
    const mcp = { servers: [{ id: "a", url: "https://x/mcp", userToken: "secret-tok" }] };
    const res = await call("POST", "/v1/rooms", { ...host, mcp });
    const room = (await res.json()) as { id: string };
    expect(JSON.stringify(room)).not.toContain("secret-tok");
    expect(JSON.stringify(vi.mocked(livekit.createRoom).mock.calls)).not.toContain("secret-tok");
    expect(JSON.stringify(await (await call("GET", `/v1/rooms/${room.id}`)).json())).not.toContain(
      "secret-tok",
    );
    await call("POST", `/v1/rooms/${room.id}/agent`);
    const meta = JSON.parse(vi.mocked(livekit.dispatchAgent).mock.calls[0]![1]);
    expect(meta.mcp.servers[0].userToken).toBe("secret-tok");
    expect(meta.mcp.ownerId).toBe(host.hostUserId);
  });

  it("returns 200 when the agent is already there", async () => {
    const { call, livekit } = setup();
    vi.mocked(livekit.dispatchAgent).mockResolvedValueOnce({ dispatchId: "AD_1", created: false });
    const room = (await (await call("POST", "/v1/rooms", host)).json()) as { id: string };
    expect((await call("POST", `/v1/rooms/${room.id}/agent`)).status).toBe(200);
  });

  it("404 for unknown rooms and 409 when the agent is off", async () => {
    const { call, livekit } = setup();
    expect((await call("POST", "/v1/rooms/nope/agent")).status).toBe(404);
    const room = (await (await call("POST", "/v1/rooms", { ...host, agent: "off" })).json()) as {
      id: string;
    };
    expect((await call("POST", `/v1/rooms/${room.id}/agent`)).status).toBe(409);
    expect(livekit.dispatchAgent).not.toHaveBeenCalled();
  });
});

describe("warmup", () => {
  it("wakes the worker only, idempotently", async () => {
    const { call, worker, livekit, advance } = setup();
    const r = await call("POST", "/v1/warmup", { userId: "u1" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "warming" });
    expect(worker.wake).toHaveBeenCalledTimes(1);
    expect(await (await call("POST", "/v1/warmup", { userId: "u1" })).json()).toEqual({
      status: "warm",
    });
    expect(worker.wake).toHaveBeenCalledTimes(1);
    advance(11_000);
    await call("POST", "/v1/warmup", { userId: "u1" });
    expect(worker.wake).toHaveBeenCalledTimes(2);
    expect(livekit.dispatchAgent).not.toHaveBeenCalled();
    expect(livekit.createRoom).not.toHaveBeenCalled();
  });

  it("validates input", async () => {
    const { call } = setup();
    expect((await call("POST", "/v1/warmup", {})).status).toBe(400);
  });

  it("rate limits per user", async () => {
    const { call, advance } = setup();
    for (let i = 0; i < 6; i++)
      expect((await call("POST", "/v1/warmup", { userId: "a" })).status).toBe(200);
    const limited = await call("POST", "/v1/warmup", { userId: "a" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect((await call("POST", "/v1/warmup", { userId: "b" })).status).toBe(200);
    advance(61_000);
    expect((await call("POST", "/v1/warmup", { userId: "a" })).status).toBe(200);
  });

  it("reports unavailable when the worker cannot be reached", async () => {
    const { call, worker } = setup();
    worker.wake.mockResolvedValueOnce(false);
    expect(await (await call("POST", "/v1/warmup", { userId: "u" })).json()).toEqual({
      status: "unavailable",
    });
  });

  it("wakes the worker before dispatching the agent", async () => {
    const { call, worker } = setup();
    const room = (await (await call("POST", "/v1/rooms", host)).json()) as { id: string };
    expect((await call("POST", `/v1/rooms/${room.id}/agent`, {})).status).toBe(201);
    expect(worker.wake).toHaveBeenCalledTimes(1);
  });
});
