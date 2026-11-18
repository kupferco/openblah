import { describe, expect, it, vi } from "vitest";
import { fetchRoomKeys, reportUsage, UsageMeter } from "./keys.js";

describe("UsageMeter", () => {
  it("counts only listening, thinking and speaking time", () => {
    let t = 0;
    const m = new UsageMeter(() => t);
    m.setState("initializing");
    t = 5000;
    m.setState("listening");
    t = 15000;
    m.setState("speaking");
    t = 20000;
    m.setState("idle");
    t = 60000;
    expect(m.take()).toBe(15);
    expect(m.take()).toBe(0);
  });
});

describe("server calls", () => {
  const env = { OPENBLAH_SERVER_URL: "http://s/", OPENBLAH_AGENT_SECRET: "sec" };
  it("skips when not wired to a server", async () => {
    expect(await fetchRoomKeys("r", {})).toBeNull();
  });
  it("fetches keys with the agent secret", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ mode: "trial", keys: {} })));
    await fetchRoomKeys("r1", env, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledWith(
      "http://s/internal/rooms/r1/provider-keys",
      expect.objectContaining({ headers: { Authorization: "Bearer sec" } }),
    );
  });
  it("reports exhaustion", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ counted: true, available: false })));
    expect(await reportUsage("r", 10, env, f as unknown as typeof fetch)).toBe(false);
  });
});

describe("UsageCollector", () => {
  it("collects participant time, STT per track, TTS, tokens and idle", async () => {
    const { UsageCollector, reportUsageLog } = await import("./keys.js");
    let t = 0;
    const c = new UsageCollector(() => t);
    c.participantJoined("a");
    t = 30_000;
    c.participantJoined("b");
    c.metrics({ type: "stt_metrics", audioDurationMs: 4000 } as never, "a");
    c.metrics({ type: "tts_metrics", charactersCount: 120 } as never);
    c.metrics({ type: "llm_metrics", promptTokens: 10, completionTokens: 5 } as never);
    t = 60_000;
    c.participantLeft("b");
    const d = c.take();
    expect(d.participantSeconds).toEqual({ a: 60, b: 30 });
    expect(d.sttSeconds).toEqual({ a: 4 });
    expect(d).toMatchObject({
      ttsCharacters: 120,
      llmInputTokens: 10,
      llmOutputTokens: 5,
      elapsedSeconds: 60,
      idleSeconds: 60,
    });
    expect(c.take().ttsCharacters).toBe(0);

    const env = { OPENBLAH_SERVER_URL: "http://s", OPENBLAH_AGENT_SECRET: "x" };
    const f = vi.fn(
      async () => new Response(JSON.stringify({ available: false, stop: "cost_cap" })),
    );
    expect(await reportUsageLog("r", d, env, f as unknown as typeof fetch)).toEqual({
      available: false,
      stop: "cost_cap",
    });
  });
});
