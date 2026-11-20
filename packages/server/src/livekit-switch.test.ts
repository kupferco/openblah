import { describe, expect, it, vi } from "vitest";
import { createApp, createAppFromEnv, MemoryStorage } from "./index.js";
import type { LiveKitGateway } from "./index.js";

const KEY = "test-key-1";

function gateway(ping?: () => Promise<void>): LiveKitGateway {
  return {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async (r) => `tok:${r.roomId}`),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    stopAgent: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    ...(ping ? { ping } : {}),
  };
}

const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("LiveKit Cloud / self-hosted switch", () => {
  it("rooms keep the LiveKit URL they were created on after the server switches", async () => {
    const storage = new MemoryStorage();
    const mk = (livekitUrl: string, livekitMode: "cloud" | "self_hosted") =>
      createApp({ storage, livekit: gateway(), apiKeys: [KEY], livekitUrl, livekitMode });
    const cloud = mk("wss://x.livekit.cloud", "cloud");
    const res = await post(cloud, "/v1/rooms", { hostUserId: "u1", hostDisplayName: "Dani" });
    const room = (await res.json()) as { id: string; livekitUrl: string };
    expect(room.livekitUrl).toBe("wss://x.livekit.cloud");

    // Owner switches the server to the self-hosted LiveKit.
    const self = mk("wss://rtc.example.com", "self_hosted");
    const old = (await (
      await post(self, "/v1/tokens", { roomId: room.id, userId: "u1", displayName: "Dani" })
    ).json()) as { livekitUrl: string };
    expect(old.livekitUrl).toBe("wss://x.livekit.cloud");

    const fresh = (await (
      await post(self, "/v1/rooms", { hostUserId: "u2", hostDisplayName: "Ana" })
    ).json()) as { id: string; livekitUrl: string };
    expect(fresh.livekitUrl).toBe("wss://rtc.example.com");
    const t = (await (
      await post(self, "/v1/tokens", { roomId: fresh.id, userId: "u2", displayName: "Ana" })
    ).json()) as { livekitUrl: string };
    expect(t.livekitUrl).toBe("wss://rtc.example.com");
  });

  it("health reports the mode, host and reachability, never the path or keys", async () => {
    const up = createApp({
      storage: new MemoryStorage(),
      livekit: gateway(async () => {}),
      apiKeys: [KEY],
      livekitUrl: "wss://rtc.example.com/secret-path",
      livekitMode: "self_hosted",
    });
    const body = await (await up.request("/health")).json();
    expect(body).toEqual({
      ok: true,
      livekit: { mode: "self_hosted", host: "rtc.example.com", reachable: true },
    });

    const down = createApp({
      storage: new MemoryStorage(),
      livekit: gateway(async () => {
        throw new Error("no route");
      }),
      apiKeys: [KEY],
      livekitUrl: "wss://rtc.example.com",
    });
    const res = await down.request("/health");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { livekit: unknown }).livekit).toEqual({
      mode: "cloud",
      host: "rtc.example.com",
      reachable: false,
    });
  });

  it("reads LIVEKIT_MODE and rejects unknown values", () => {
    const base = {
      LIVEKIT_URL: "wss://rtc.example.com",
      LIVEKIT_API_KEY: "k",
      LIVEKIT_API_SECRET: "s",
      OPENBLAH_API_KEYS: KEY,
    };
    expect(() => createAppFromEnv({ ...base, LIVEKIT_MODE: "self_hosted" })).not.toThrow();
    expect(() => createAppFromEnv(base)).not.toThrow();
    expect(() => createAppFromEnv({ ...base, LIVEKIT_MODE: "selfhost" })).toThrow(/LIVEKIT_MODE/);
  });
});
