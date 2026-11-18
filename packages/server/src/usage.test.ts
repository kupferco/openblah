import { describe, expect, it, vi } from "vitest";
import {
  createApp,
  MemoryStorage,
  parsePrices,
  TrialService,
  UsageService,
  type CostAlert,
  type LiveKitGateway,
  type ProviderKeys,
  type TokenVerifier,
  type UsageLimits,
} from "./index.js";

const API = "api-key-1";
const AGENT = "agent-secret";
const TRIAL: ProviderKeys = { gemini: "tg", deepgram: "td", cartesia: "tc" };

function setup(
  opts: {
    limits?: Partial<UsageLimits>;
    cap?: number;
    trial?: boolean;
    prices?: ReturnType<typeof parsePrices>;
  } = {},
) {
  const storage = new MemoryStorage();
  const alerts: CostAlert[] = [];
  const usage = new UsageService(storage, {
    monthlyCapGbp: opts.cap ?? 50,
    prices: opts.prices,
    limits: {
      maxRoomSeconds: 3600,
      idleTimeoutSeconds: 300,
      userMonthlyMinutes: 0,
      hostMonthlyMinutes: 0,
      ...opts.limits,
    },
    notify: (a) => void alerts.push(a),
    now: () => new Date("2026-11-17T12:00:00Z"),
  });
  const livekit: LiveKitGateway = {
    createRoom: vi.fn(async () => {}),
    createToken: vi.fn(async () => "tok"),
    dispatchAgent: vi.fn(async () => ({ dispatchId: "AD_1", created: true })),
    updateRoomMetadata: vi.fn(async () => {}),
    deleteRoom: vi.fn(async () => {}),
    removeParticipant: vi.fn(async () => {}),
    sendData: vi.fn(async () => {}),
  };
  const verifier: TokenVerifier = {
    verify: async (t) =>
      t.startsWith("fb:") ? { uid: t.slice(3), email: `${t.slice(3)}@x.test` } : null,
  };
  const app = createApp({
    storage,
    livekit,
    apiKeys: [API],
    usage,
    trial: opts.trial
      ? {
          keys: TRIAL,
          service: new TrialService(storage, {
            perAccountSeconds: 100_000,
            perDeviceSeconds: 100_000,
            globalSeconds: 1e9,
          }),
        }
      : undefined,
    productKeys: opts.trial
      ? {}
      : { "*": { keys: { gemini: "g", deepgram: "d", cartesia: "c" }, tier: "paid" } },
    verifier,
    agentSecret: AGENT,
  });
  const call = (method: string, path: string, body?: unknown, token: string = API) =>
    app.request(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const room = async (host: string, extra = {}) => {
    const r = await call("POST", "/v1/rooms", { hostUserId: host, hostDisplayName: "H", ...extra });
    return (await r.json()) as { id: string; maxDurationSeconds?: number };
  };
  const report = async (id: string, body: unknown) => {
    const r = await call("POST", `/internal/rooms/${id}/usage`, body, AGENT);
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  return { call, room, report, usage, alerts, storage, app };
}

describe("usage log", () => {
  it("logs minutes, STT per track, TTS, tokens and estimates cost per provider", async () => {
    const { room, report, call } = setup({
      prices: parsePrices(
        JSON.stringify({
          livekitPerParticipantMinute: 0.01,
          sttPerSecond: 0.001,
          ttsPerCharacter: 0.0001,
          llmInputPerMillionTokens: 1,
          llmOutputPerMillionTokens: 4,
        }),
      ),
    });
    const { id } = await room("host");
    await report(id, {
      seconds: 30,
      elapsedSeconds: 60,
      participantSeconds: { host: 60, guest: 60 },
      sttSeconds: { "trk/1": 20, trk2: 10 },
      ttsCharacters: 1000,
      llmInputTokens: 2_000_000,
      llmOutputTokens: 500_000,
    });
    const res = await call("GET", `/v1/rooms/${id}/usage?actorUserId=host`);
    expect(res.status).toBe(200);
    const u = (await res.json()) as {
      participantMinutes: number;
      sttSecondsByTrack: Record<string, number>;
      ttsCharacters: number;
      llmInputTokens: number;
      estimatedCostGbp: Record<string, number>;
    };
    expect(u.participantMinutes).toBe(2);
    expect(u.sttSecondsByTrack).toEqual({ "trk/1": 20, trk2: 10 });
    expect(u.ttsCharacters).toBe(1000);
    expect(u.llmInputTokens).toBe(2_000_000);
    expect(u.estimatedCostGbp.livekit).toBeCloseTo(0.02);
    expect(u.estimatedCostGbp.stt).toBeCloseTo(0.03);
    expect(u.estimatedCostGbp.tts).toBeCloseTo(0.1);
    expect(u.estimatedCostGbp.llm).toBeCloseTo(4);
    expect(u.estimatedCostGbp.total).toBeCloseTo(4.15);
  });

  it("is read-only and host only", async () => {
    const { room, call } = setup();
    const { id } = await room("host");
    expect((await call("GET", `/v1/rooms/${id}/usage?actorUserId=other`)).status).toBe(403);
    expect((await call("GET", `/v1/rooms/${id}/usage`)).status).toBe(400);
    expect((await call("POST", `/v1/rooms/${id}/usage?actorUserId=host`, {})).status).toBe(404);
  });

  it("rejects bad reports", async () => {
    const { room, report } = setup();
    const { id } = await room("host");
    expect((await report(id, { sttSeconds: { a: -1 } })).status).toBe(400);
    expect((await report(id, { ttsCharacters: "x" })).status).toBe(400);
    expect((await report(id, { seconds: 99999 })).status).toBe(400);
  });
});

describe("room limits", () => {
  it("stops at max duration", async () => {
    const { room, report } = setup({ limits: { maxRoomSeconds: 100 } });
    const { id } = await room("host");
    expect((await report(id, { elapsedSeconds: 60 })).json).toMatchObject({ available: true });
    expect((await report(id, { elapsedSeconds: 60 })).json).toMatchObject({
      available: false,
      stop: "max_duration",
    });
  });

  it("lets a host lower but not raise the limit", async () => {
    const { room, usage } = setup({ limits: { maxRoomSeconds: 1000, idleTimeoutSeconds: 300 } });
    const low = await room("host", { maxDurationSeconds: 60, idleTimeoutSeconds: 30 });
    const high = await room("host", { maxDurationSeconds: 5000 });
    expect(usage.roomLimits(low as never)).toEqual({ maxRoomSeconds: 60, idleTimeoutSeconds: 30 });
    expect(usage.roomLimits(high as never).maxRoomSeconds).toBe(1000);
  });

  it("validates room limit fields", async () => {
    const { call } = setup();
    const r = await call("POST", "/v1/rooms", {
      hostUserId: "h",
      hostDisplayName: "H",
      maxDurationSeconds: -5,
    });
    expect(r.status).toBe(400);
  });

  it("stops after the idle timeout", async () => {
    const { room, report } = setup({ limits: { idleTimeoutSeconds: 120 } });
    const { id } = await room("host");
    expect((await report(id, { idleSeconds: 60 })).json.available).toBe(true);
    expect((await report(id, { idleSeconds: 120 })).json).toMatchObject({
      available: false,
      stop: "idle_timeout",
    });
  });
});

describe("monthly minute caps", () => {
  it("stops per user and blocks a new start", async () => {
    const { room, report, call } = setup({ limits: { userMonthlyMinutes: 10 } });
    const { id } = await room("host");
    expect((await report(id, { participantSeconds: { alice: 540 } })).json.available).toBe(true);
    expect((await report(id, { participantSeconds: { alice: 60 } })).json).toMatchObject({
      available: false,
      stop: "user_cap",
    });
    // Alice joins another room of the same host: the agent will not start.
    const other = await room("host2");
    await call("POST", "/v1/tokens", {
      roomId: other.id,
      userId: "alice",
      displayName: "Alice",
    });
    const start = await call("POST", `/v1/rooms/${other.id}/agent`, {});
    expect(start.status).toBe(429);
    expect(await start.json()).toMatchObject({ code: "user_cap" });
  });

  it("stops per host", async () => {
    const { room, report, call } = setup({ limits: { hostMonthlyMinutes: 5 } });
    const { id } = await room("host");
    expect((await report(id, { seconds: 200 })).json.available).toBe(true);
    expect((await report(id, { seconds: 100 })).json).toMatchObject({
      available: false,
      stop: "host_cap",
    });
    const again = await room("host");
    expect((await call("POST", `/v1/rooms/${again.id}/agent`, {})).status).toBe(429);
    const fine = await room("someone-else");
    expect((await call("POST", `/v1/rooms/${fine.id}/agent`, {})).status).toBe(201);
  });
});

describe("monthly cost counter and the hard cap", () => {
  // 1 GBP per 1000 characters, to make the maths easy.
  const prices = parsePrices(JSON.stringify({ ttsPerCharacter: 0.001 }));

  it("warns once at 80% with a structured alert", async () => {
    const { room, report, alerts, storage } = setup({ trial: true, cap: 50, prices });
    await storage.upsertUser({ id: "u1", email: "u1@x.test", isTest: false, createdAt: "x" });
    const { id } = await room("u1");
    await report(id, { ttsCharacters: 39_000 }); // £39
    expect(alerts).toHaveLength(0);
    await report(id, { ttsCharacters: 2000 }); // £41
    await report(id, { ttsCharacters: 1000 }); // £42
    expect(alerts).toEqual([
      { event: "cost_alert", level: "warning_80", month: "2026-11", hostedCostGbp: 41, capGbp: 50 },
    ]);
  });

  it("stops the trial key at £50 and refuses new trial rooms", async () => {
    const { room, report, call, alerts, storage } = setup({ trial: true, cap: 50, prices });
    await storage.upsertUser({ id: "u1", email: "u1@x.test", isTest: false, createdAt: "x" });
    await storage.upsertUser({ id: "u2", email: "u2@x.test", isTest: false, createdAt: "x" });
    const { id } = await room("u1");
    expect((await call("POST", `/v1/rooms/${id}/agent`, {})).status).toBe(201);
    expect((await report(id, { ttsCharacters: 49_000 })).json.available).toBe(true);
    const over = await report(id, { ttsCharacters: 1000 });
    expect(over.json).toMatchObject({ counted: true, available: false, stop: "cost_cap" });
    expect(alerts.map((a) => a.level)).toEqual(["warning_80", "hard_cap"]);
    // A new trial room cannot start either.
    const next = await room("u2");
    const start = await call("POST", `/v1/rooms/${next.id}/agent`, {});
    expect(start.status).toBe(402);
    expect(await start.json()).toMatchObject({ code: "trial_exhausted" });
  });

  it("does not stop rooms on product keys, but still counts their cost", async () => {
    const { room, report, usage, call } = setup({ cap: 50, prices });
    const { id } = await room("u1");
    const r = await report(id, { ttsCharacters: 60_000 });
    expect(r.json).toMatchObject({ counted: false, available: true });
    expect(await usage.hostedCostThisMonth()).toBe(0);
    expect((await call("POST", `/v1/rooms/${id}/agent`, {})).status).toBe(201);
  });

  it("a webhook failure never breaks reporting", async () => {
    const storage = new MemoryStorage();
    const usage = new UsageService(storage, {
      monthlyCapGbp: 1,
      notify: () => {
        throw new Error("boom");
      },
    });
    const room = { id: "r", hostUserId: "h" } as never;
    await expect(usage.record(room, { ttsCharacters: 1e6 }, true)).resolves.toMatchObject({
      available: false,
      stop: "cost_cap",
    });
  });
});

describe("price table", () => {
  it("merges overrides and rejects junk", () => {
    expect(parsePrices('{"sttPerSecond":0.5}').sttPerSecond).toBe(0.5);
    expect(() => parsePrices('{"nope":1}')).toThrow();
    expect(() => parsePrices('{"sttPerSecond":-1}')).toThrow();
  });
});
