import type { llm, stt, tts } from "@livekit/agents";
import { describe, expect, it, vi } from "vitest";
import {
  BARGE_IN_MIN_DURATION_MS,
  buildSessionOptions,
  buildTurnLatencyLog,
  configFromEnv,
  DEFAULT_GEMINI_MODEL,
  defaultProviders,
  DirectAgent,
  detectLanguage,
  directInstructions,
  turnHandling,
  type ProviderSet,
  type SpokenLanguage,
} from "./index.js";

function mockProviders() {
  const setLanguage = vi.fn<(e: tts.TTS, l: SpokenLanguage) => void>();
  const engines = {
    stt: { id: "stt" } as unknown as stt.STT,
    llm: { id: "llm" } as unknown as llm.LLM,
    tts: { id: "tts" } as unknown as tts.TTS,
  };
  const providers: ProviderSet = {
    stt: { name: "mock-stt", createStt: () => engines.stt },
    llm: { name: "mock-llm", createLlm: () => engines.llm },
    tts: { name: "mock-tts", createTts: () => engines.tts, setLanguage },
  };
  return { providers, engines, setLanguage };
}

describe("detectLanguage", () => {
  it("detects English and Portuguese", () => {
    expect(detectLanguage("What is the weather like today?")).toBe("en");
    expect(detectLanguage("Qual é a previsão do tempo para amanhã?")).toBe("pt");
    expect(detectLanguage("Olá, você pode me ajudar?")).toBe("pt");
  });
  it("keeps the previous language when unclear", () => {
    expect(detectLanguage("", "pt")).toBe("pt");
    expect(detectLanguage("Netflix", "pt")).toBe("pt");
    expect(detectLanguage("ok", "en")).toBe("en");
  });
});

describe("DirectAgent", () => {
  it("switches TTS language only when the speaker's language changes", async () => {
    const { providers, engines, setLanguage } = mockProviders();
    const agent = new DirectAgent({ agentName: "Blah" }, providers.tts);
    agent.bindTts(engines.tts);
    agent.applyLanguage("What time is it?");
    expect(setLanguage).not.toHaveBeenCalled();
    agent.applyLanguage("Que horas são agora?");
    expect(setLanguage).toHaveBeenCalledWith(engines.tts, "pt");
    agent.applyLanguage("Obrigado, você é muito bom");
    expect(setLanguage).toHaveBeenCalledTimes(1);
    agent.applyLanguage("Thanks, that is great");
    expect(setLanguage).toHaveBeenLastCalledWith(engines.tts, "en");
  });
});

describe("session options", () => {
  it("wires the providers and turn handling", () => {
    const { providers, engines } = mockProviders();
    const opts = buildSessionOptions(providers, null, "vad");
    expect(opts.stt).toBe(engines.stt);
    expect(opts.llm).toBe(engines.llm);
    expect(opts.tts).toBe(engines.tts);
    expect(opts.turnHandling?.interruption?.enabled).toBe(true);
  });
  it("allows barge-in within 300 ms and tolerates backchannels", () => {
    const t = turnHandling("vad");
    expect(BARGE_IN_MIN_DURATION_MS).toBeLessThanOrEqual(300);
    expect(t.interruption?.minDuration).toBe(BARGE_IN_MIN_DURATION_MS);
    expect(t.interruption?.resumeFalseInterruption).toBe(true);
  });
});

describe("gemini model", () => {
  const model = (env: Record<string, string>) =>
    (defaultProviders({ GEMINI_API_KEY: "k", ...env }).llm.createLlm() as { model: string }).model;
  it("defaults to gemini-3.8-flash", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.8-flash");
    expect(model({})).toBe("gemini-3.8-flash");
    expect(model({ GEMINI_MODEL: "" })).toBe("gemini-3.8-flash");
  });
  it("can be overridden with GEMINI_MODEL", () => {
    expect(model({ GEMINI_MODEL: "gemini-other" })).toBe("gemini-other");
  });
});

describe("config and prompt", () => {
  it("defaults the agent name and dispatch name", () => {
    expect(configFromEnv({}).agentName).toBe("Blah");
    expect(configFromEnv({ OPENBLAH_AGENT_NAME: "Zed" }).agentName).toBe("Zed");
    expect(configFromEnv({}).dispatchName).toBe("openblah-agent");
  });
  it("asks for short replies in the speaker's language", () => {
    const p = directInstructions({ agentName: "Zed" });
    expect(p).toContain("Zed");
    expect(p).toMatch(/one to three sentences/);
    expect(p).toMatch(/language the person just spoke/);
  });
});

describe("turn latency log", () => {
  it("converts seconds to ms and is JSON serialisable", () => {
    const log = buildTurnLatencyLog({
      roomId: "rm_1",
      turn: 2,
      metrics: { e2eLatency: 0.9, llmNodeTtft: 0.35, ttsNodeTtfb: 0.12 },
      interrupted: false,
      language: "pt",
      now: new Date("2026-01-01T00:00:00Z"),
    });
    expect(log).toMatchObject({
      event: "turn_latency",
      roomId: "rm_1",
      turn: 2,
      endOfSpeechToFirstAudioMs: 900,
      llmFirstTokenMs: 350,
      ttsFirstByteMs: 120,
      endOfTurnDelayMs: null,
      language: "pt",
    });
    expect(JSON.parse(JSON.stringify(log))).toEqual(log);
  });
  it("handles missing metrics", () => {
    const log = buildTurnLatencyLog({
      turn: 1,
      metrics: undefined,
      interrupted: true,
      language: "en",
    });
    expect(log.endOfSpeechToFirstAudioMs).toBeNull();
    expect(log.interrupted).toBe(true);
  });
});
