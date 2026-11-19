import { describe, expect, it, vi } from "vitest";
import { createApp, MemoryStorage } from "./index.js";
import type { LiveKitGateway, TokenVerifier } from "./index.js";

function setup(wake = vi.fn(async () => true)) {
  const storage = new MemoryStorage();
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async () => "tok"),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    stopAgent: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
  };
  const verifier: TokenVerifier = {
    verify: async (t) =>
      t.startsWith("fb:") ? { uid: t.slice(3), email: `${t.slice(3)}@x.test` } : null,
  };
  const app = createApp({
    storage,
    livekit,
    apiKeys: ["k"],
    verifier,
    worker: { wake },
    livekitUrl: "wss://lk.test",
    agentSecret: "a",
  });
  const post = (path: string, body: unknown, token: string | null) =>
    app.request(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  return { storage, livekit, post, wake };
}

describe("standalone app: /v1/me/calls and /v1/me/warmup", () => {
  it("starts a room hosted by the verified user and returns a token", async () => {
    const { post, livekit, storage } = setup();
    const res = await post("/v1/me/calls", { displayName: "Ana", agentName: "Sol" }, "fb:u1");
    expect(res.status).toBe(201);
    const body = (await res.json()) as { roomId: string; token: string; livekitUrl: string };
    expect(body).toMatchObject({ token: "tok", livekitUrl: "wss://lk.test" });
    const room = await storage.getRoom(body.roomId);
    expect(room).toMatchObject({ hostUserId: "u1", agentName: "Sol", agent: "on" });
    expect(livekit.createToken).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", isHost: true, role: "host" }),
    );
  });

  it("rejects a missing or bad ID token, a product API key and a missing name", async () => {
    const { post } = setup();
    expect((await post("/v1/me/calls", { displayName: "A" }, null)).status).toBe(401);
    expect((await post("/v1/me/calls", { displayName: "A" }, "k")).status).toBe(401);
    expect((await post("/v1/me/calls", {}, "fb:u1")).status).toBe(400);
  });

  it("wakes the worker for a signed-in user only", async () => {
    const { post, wake } = setup();
    expect((await post("/v1/me/warmup", {}, null)).status).toBe(401);
    expect(wake).not.toHaveBeenCalled();
    const res = await post("/v1/me/warmup", {}, "fb:u1");
    expect(await res.json()).toEqual({ status: "warming" });
  });
});
