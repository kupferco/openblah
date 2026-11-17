import { describe, expect, it, vi } from "vitest";
import { createApp, KeyCipher, KeyStore, MemoryStorage, TrialService, apiKeyId } from "./index.js";
import type { LiveKitGateway, ProviderKeys, TokenVerifier } from "./index.js";

const API = "api-key-1";
const AGENT = "agent-secret";
const SECRET_VALUE = "sk-super-secret-value";
const PRODUCT: ProviderKeys = { gemini: "pg", deepgram: "pd", cartesia: "pc" };
const TRIAL: ProviderKeys = { gemini: "tg", deepgram: "td", cartesia: "tc" };

function setup(opts: { product?: boolean; trial?: boolean; trialSeconds?: number } = {}) {
  const storage = new MemoryStorage();
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async () => "tok"),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
  };
  const verifier: TokenVerifier = {
    verify: async (t) =>
      t.startsWith("fb:") ? { uid: t.slice(3), email: `${t.slice(3)}@x.test` } : null,
  };
  const app = createApp({
    storage,
    livekit,
    apiKeys: [API],
    keyStore: new KeyStore(storage, new KeyCipher("secret-one")),
    productKeys: opts.product ? { [apiKeyId(API)]: { keys: PRODUCT, tier: "paid" } } : {},
    trial: opts.trial
      ? {
          keys: TRIAL,
          service: new TrialService(storage, {
            perAccountSeconds: opts.trialSeconds ?? 300,
            perDeviceSeconds: 400,
            globalSeconds: 1000,
          }),
        }
      : undefined,
    verifier,
    agentSecret: AGENT,
  });
  const call = (
    method: string,
    path: string,
    body?: unknown,
    token: string | null = API,
    extra = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const room = async (host: string, sensitive = false, metadata = {}) =>
    (
      (await (
        await call("POST", "/v1/rooms", {
          hostUserId: host,
          hostDisplayName: "H",
          sensitive,
          metadata,
        })
      ).json()) as { id: string }
    ).id;
  const saveAll = async (host: string, tier: "free" | "paid", confirmed = false) => {
    for (const p of ["gemini", "deepgram", "cartesia"]) {
      const r = await call("PUT", `/v1/users/${host}/keys/${p}`, {
        key: SECRET_VALUE,
        tier,
        noTrainingConfirmed: confirmed,
      });
      expect(r.status).toBe(200);
    }
  };
  return { call, room, saveAll, storage, livekit };
}

describe("encryption", () => {
  it("round trips and binds to owner and provider", () => {
    const c = new KeyCipher("s");
    const sealed = c.seal(SECRET_VALUE, "u1|gemini");
    expect(JSON.stringify(sealed)).not.toContain(SECRET_VALUE);
    expect(c.open(sealed, "u1|gemini")).toBe(SECRET_VALUE);
    expect(() => c.open(sealed, "u2|gemini")).toThrow();
    expect(() =>
      c.open({ ...sealed, ciphertext: Buffer.from("xx").toString("base64") }, "u1|gemini"),
    ).toThrow();
  });

  it("opens old data after rotation and seals new data with the new secret", () => {
    const old = new KeyCipher("a").seal("v", "x");
    expect(old.keyVersion).toBe("v1");
    const rotated = new KeyCipher("v2:b,v1:a");
    expect(rotated.open(old, "x")).toBe("v");
    expect(rotated.seal("v", "x").keyVersion).toBe("v2");
    expect(() => new KeyCipher("v2:b").open(old, "x")).toThrow();
  });

  it("stores only ciphertext", async () => {
    const { saveAll, storage } = setup();
    await saveAll("u1", "paid", true);
    const stored = await storage.listKeys("u1");
    expect(stored).toHaveLength(3);
    expect(JSON.stringify(stored)).not.toContain(SECRET_VALUE);
  });
});

describe("key never leaves the server", () => {
  it("is not returned by save, list, room, key-mode or token endpoints", async () => {
    const { call, room, saveAll } = setup();
    await saveAll("u1", "paid", true);
    const id = await room("u1");
    const bodies = [
      await (
        await call("PUT", "/v1/users/u1/keys/gemini", { key: SECRET_VALUE, tier: "paid" })
      ).text(),
      await (await call("GET", "/v1/users/u1/keys")).text(),
      await (await call("GET", `/v1/rooms/${id}`)).text(),
      await (await call("GET", `/v1/rooms/${id}/key-mode`)).text(),
      await (await call("POST", `/v1/rooms/${id}/agent`, {})).text(),
    ];
    for (const b of bodies) expect(b).not.toContain(SECRET_VALUE);
    expect(bodies[0]).not.toContain("ciphertext");
  });

  it("only the agent secret reaches plaintext keys", async () => {
    const { call, room, saveAll } = setup();
    await saveAll("u1", "paid", true);
    const id = await room("u1");
    expect((await call("POST", `/internal/rooms/${id}/provider-keys`, {}, API)).status).toBe(401);
    expect((await call("POST", `/internal/rooms/${id}/provider-keys`, {}, null)).status).toBe(401);
    const ok = await call("POST", `/internal/rooms/${id}/provider-keys`, {}, AGENT);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ mode: "byok", keys: { gemini: SECRET_VALUE } });
  });

  it("delete removes the key", async () => {
    const { call, saveAll, storage } = setup();
    await saveAll("u1", "paid");
    expect((await call("DELETE", "/v1/users/u1/keys/gemini")).status).toBe(204);
    expect((await call("DELETE", "/v1/users/u1/keys/gemini")).status).toBe(404);
    expect(await storage.listKeys("u1")).toHaveLength(2);
  });

  it("uses only the owner's keys", async () => {
    const { call, room, saveAll } = setup({ trial: true });
    await saveAll("u1", "paid");
    const id = await room("u2"); // another host: u1's keys must not apply
    const r = await call("GET", `/v1/rooms/${id}/key-mode`);
    expect(r.status).toBe(401); // no BYOK, not signed in for trial
  });
});

describe("key modes", () => {
  it("host BYOK beats product key; product key used otherwise", async () => {
    const { call, room, saveAll } = setup({ product: true });
    const a = await room("u1");
    expect(await (await call("GET", `/v1/rooms/${a}/key-mode`)).json()).toMatchObject({
      mode: "product",
    });
    await saveAll("u1", "paid");
    expect(await (await call("GET", `/v1/rooms/${a}/key-mode`)).json()).toMatchObject({
      mode: "byok",
    });
  });

  it("no keys at all is refused", async () => {
    const { call, room } = setup();
    const id = await room("u1");
    expect((await call("POST", `/v1/rooms/${id}/agent`, {})).status).toBe(409);
  });
});

describe("sensitive rooms", () => {
  it("refuse free-tier BYOK, unconfirmed keys and the trial", async () => {
    const { call, room, saveAll } = setup({ trial: true });
    await call("GET", "/v1/me", undefined, "fb:u1");
    await saveAll("u1", "free");
    const id = await room("u1", true);
    const res = await call("POST", `/v1/rooms/${id}/agent`, {});
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("sensitive_free_tier");
    expect(body.error).toContain("does not train");

    await saveAll("u1", "paid", false);
    expect((await call("GET", `/v1/rooms/${id}/key-mode`)).status).toBe(403);

    await call("DELETE", "/v1/users/u1/keys/gemini");
    await call("DELETE", "/v1/users/u1/keys/deepgram");
    await call("DELETE", "/v1/users/u1/keys/cartesia");
    expect((await call("GET", `/v1/rooms/${id}/key-mode`)).status).toBe(403); // trial is free tier
  });

  it("accept paid, confirmed keys", async () => {
    const { call, room, saveAll, livekit } = setup();
    await saveAll("u1", "paid", true);
    const id = await room("u1", true);
    expect((await call("POST", `/v1/rooms/${id}/agent`, {})).status).toBe(201);
    expect(livekit.dispatchAgent).toHaveBeenCalled();
  });

  it("refuse a free-tier product key", async () => {
    const storage = new MemoryStorage();
    const app = createApp({
      storage,
      apiKeys: [API],
      livekit: {
        createRoom: async () => {},
        createToken: async () => "t",
        dispatchAgent: async () => ({ dispatchId: "d", created: true }),
        updateRoomMetadata: async () => {},
        deleteRoom: async () => {},
        removeParticipant: async () => {},
      },
      productKeys: { "*": { keys: PRODUCT, tier: "free" } },
    });
    const h = { Authorization: `Bearer ${API}`, "Content-Type": "application/json" };
    const r = await app.request("/v1/rooms", {
      method: "POST",
      headers: h,
      body: JSON.stringify({ hostUserId: "u", hostDisplayName: "n", sensitive: true }),
    });
    const { id } = (await r.json()) as { id: string };
    expect(
      (await app.request(`/v1/rooms/${id}/agent`, { method: "POST", headers: h, body: "{}" }))
        .status,
    ).toBe(403);
  });
});

describe("trial", () => {
  it("requires sign-in", async () => {
    const { call, room } = setup({ trial: true });
    const id = await room("ghost");
    expect((await call("POST", `/v1/rooms/${id}/agent`, {})).status).toBe(401);
  });

  it("is exhausted after 300 seconds of counted audio", async () => {
    const { call, room } = setup({ trial: true });
    expect(await (await call("GET", "/v1/me/trial", undefined, "fb:u1")).json()).toMatchObject({
      remainingSeconds: 300,
      available: true,
    });
    const id = await room("u1");
    expect((await call("GET", `/v1/rooms/${id}/key-mode`)).status).toBe(200);
    const u1 = await call("POST", `/internal/rooms/${id}/usage`, { seconds: 120 }, AGENT);
    expect(await u1.json()).toMatchObject({
      counted: true,
      usedSeconds: 120,
      remainingSeconds: 180,
    });
    const u2 = await call("POST", `/internal/rooms/${id}/usage`, { seconds: 500 }, AGENT);
    expect(await u2.json()).toMatchObject({
      counted: true,
      usedSeconds: 300,
      remainingSeconds: 0,
      available: false,
      reason: "account_used",
    });
    const res = await call("POST", `/v1/rooms/${id}/agent`, {});
    expect(res.status).toBe(402);
    expect(((await res.json()) as { code: string }).code).toBe("trial_exhausted");
    expect(await (await call("GET", "/v1/me/trial", undefined, "fb:u1")).json()).toMatchObject({
      available: false,
    });
  });

  it("applies the per-device soft limit across accounts and the global cap", async () => {
    const { call } = setup({ trial: true, trialSeconds: 300 });
    const h = { "x-openblah-device": "dev-1" };
    for (const u of ["a", "b"]) await call("GET", "/v1/me", undefined, `fb:${u}`);
    const mk = async (u: string) =>
      (
        (await (
          await call("POST", "/v1/rooms", {
            hostUserId: u,
            hostDisplayName: "n",
            metadata: { deviceId: "dev-1" },
          })
        ).json()) as { id: string }
      ).id;
    const a = await mk("a");
    await call("POST", `/internal/rooms/${a}/usage`, { seconds: 300 }, AGENT);
    const b = await mk("b");
    await call("POST", `/internal/rooms/${b}/usage`, { seconds: 100 }, AGENT);
    // device now at 400 (its limit): account b still has seconds left but the device does not
    const st = await call("GET", "/v1/me/trial", undefined, "fb:b", h);
    expect(await st.json()).toMatchObject({ available: false, reason: "device_limit" });
    expect((await call("GET", "/v1/me/trial", undefined, "fb:b")).status).toBe(200);
  });

  it("usage is not counted for BYOK rooms", async () => {
    const { call, room, saveAll } = setup({ trial: true });
    await saveAll("u1", "paid");
    const id = await room("u1");
    const r = await call("POST", `/internal/rooms/${id}/usage`, { seconds: 50 }, AGENT);
    expect(await r.json()).toEqual({ counted: false });
  });
});

describe("accounts", () => {
  it("rejects bad Firebase tokens and flags the preview test user", async () => {
    const { call, storage } = setup({ trial: true });
    expect((await call("GET", "/v1/me", undefined, "nope")).status).toBe(401);
    expect((await call("GET", "/v1/me", undefined, null)).status).toBe(401);
    expect((await call("GET", "/v1/me", undefined, "fb:u1")).status).toBe(200);
    expect(await storage.getUser("u1")).toMatchObject({ isTest: false });
  });

  it("saves keys for the signed-in user only", async () => {
    const { call, storage } = setup();
    const r = await call("PUT", "/v1/me/keys/gemini", { key: SECRET_VALUE, tier: "free" }, "fb:u1");
    expect(r.status).toBe(200);
    expect(await storage.listKeys("u1")).toHaveLength(1);
    expect(await storage.listKeys("u2")).toHaveLength(0);
  });

  it("validates key input", async () => {
    const { call } = setup();
    expect((await call("PUT", "/v1/users/u/keys/openai", { key: "k", tier: "paid" })).status).toBe(
      400,
    );
    expect((await call("PUT", "/v1/users/u/keys/gemini", { key: "k", tier: "gold" })).status).toBe(
      400,
    );
    expect((await call("PUT", "/v1/users/u/keys/gemini", { tier: "paid" })).status).toBe(400);
  });
});
