import { claudeLlm } from "./anthropic.js";
import { assemblyAiStt } from "./assemblyai.js";
import { cartesiaTts } from "./cartesia.js";
import { deepgramStt } from "./deepgram.js";
import { elevenLabsTts } from "./elevenlabs.js";
import { geminiLlm } from "./gemini.js";
import { openaiLlm, openaiStt, openaiTts } from "./openai.js";
import type { LlmProvider, ProviderSet, SttProvider, TtsProvider } from "./types.js";

export const LLM_PROVIDERS = ["gemini", "openai", "claude"] as const;
export const STT_PROVIDERS = ["deepgram", "openai", "assemblyai"] as const;
export const TTS_PROVIDERS = ["cartesia", "openai", "elevenlabs"] as const;

export type LlmName = (typeof LLM_PROVIDERS)[number];
export type SttName = (typeof STT_PROVIDERS)[number];
export type TtsName = (typeof TTS_PROVIDERS)[number];

/** One choice: a provider and, optionally, its model (or voice for TTS). Keys never live here. */
export interface Choice<N extends string> {
  provider: N;
  model?: string;
  voice?: string;
}

/** A provider setting at one level. Any part may be absent; the level below fills it in. */
export interface ProviderChoice {
  llm?: Choice<LlmName>;
  stt?: Choice<SttName>;
  tts?: Choice<TtsName>;
}

/** The three levels, highest precedence first: room, user/product, server default. */
export interface ProviderLevels {
  room?: ProviderChoice;
  user?: ProviderChoice;
  server?: ProviderChoice;
}

const FALLBACK: Required<ProviderChoice> = {
  llm: { provider: "gemini" },
  stt: { provider: "deepgram" },
  tts: { provider: "cartesia" },
};

/** Resolve each part (llm, stt, tts) separately: room beats user/product beats server default. */
export function resolveProviderChoice(levels: ProviderLevels): Required<ProviderChoice> {
  const pick = <K extends keyof ProviderChoice>(k: K): NonNullable<ProviderChoice[K]> =>
    (levels.room?.[k] ?? levels.user?.[k] ?? levels.server?.[k] ?? FALLBACK[k]) as NonNullable<
      ProviderChoice[K]
    >;
  return { llm: pick("llm"), stt: pick("stt"), tts: pick("tts") };
}

type Env = Record<string, string | undefined>;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

function parseChoice<T extends string>(list: readonly T[], raw: unknown): Choice<T> | undefined {
  const r = raw as { provider?: unknown; model?: unknown; voice?: unknown } | null;
  if (!r || !isOneOf(list, r.provider)) return undefined;
  return {
    provider: r.provider,
    ...(typeof r.model === "string" && r.model ? { model: r.model } : {}),
    ...(typeof r.voice === "string" && r.voice ? { voice: r.voice } : {}),
  };
}

/** Validate an untrusted choice (job metadata, user settings). Unknown providers are dropped. */
export function parseProviderChoice(raw: unknown): ProviderChoice | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: ProviderChoice = {
    llm: parseChoice(LLM_PROVIDERS, r.llm),
    stt: parseChoice(STT_PROVIDERS, r.stt),
    tts: parseChoice(TTS_PROVIDERS, r.tts),
  };
  if (!out.llm) delete out.llm;
  if (!out.stt) delete out.stt;
  if (!out.tts) delete out.tts;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The room's choice from the dispatch job metadata (`{ "providers": { "llm": {...} } }`). */
export function parseRoomProviders(metadata: string | undefined): ProviderChoice | undefined {
  if (!metadata) return undefined;
  try {
    return parseProviderChoice((JSON.parse(metadata) as { providers?: unknown } | null)?.providers);
  } catch {
    return undefined;
  }
}

/** The server default from the environment (OPENBLAH_LLM_PROVIDER, ..._MODEL, ...). */
export function serverProviderChoice(env: Env = process.env): ProviderChoice | undefined {
  return parseProviderChoice({
    llm: { provider: env.OPENBLAH_LLM_PROVIDER, model: env.OPENBLAH_LLM_MODEL },
    stt: { provider: env.OPENBLAH_STT_PROVIDER, model: env.OPENBLAH_STT_MODEL },
    tts: {
      provider: env.OPENBLAH_TTS_PROVIDER,
      model: env.OPENBLAH_TTS_MODEL,
      voice: env.OPENBLAH_TTS_VOICE,
    },
  });
}

/** Env var holding each provider's API key. */
export const KEY_ENV = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
  deepgram: "DEEPGRAM_API_KEY",
  assemblyai: "ASSEMBLYAI_API_KEY",
  cartesia: "CARTESIA_API_KEY",
  elevenlabs: "ELEVEN_API_KEY",
} as const;

export function createLlmProvider(c: Choice<LlmName>, env: Env = process.env): LlmProvider {
  switch (c.provider) {
    case "openai":
      return openaiLlm({ apiKey: env.OPENAI_API_KEY, model: c.model || env.OPENAI_MODEL });
    case "claude":
      return claudeLlm({ apiKey: env.ANTHROPIC_API_KEY, model: c.model || env.ANTHROPIC_MODEL });
    case "gemini":
      return geminiLlm({ apiKey: env.GEMINI_API_KEY, model: c.model || env.GEMINI_MODEL });
  }
}

export function createSttProvider(c: Choice<SttName>, env: Env = process.env): SttProvider {
  switch (c.provider) {
    case "openai":
      return openaiStt({ apiKey: env.OPENAI_API_KEY, model: c.model });
    case "assemblyai":
      return assemblyAiStt({ apiKey: env.ASSEMBLYAI_API_KEY });
    case "deepgram":
      return deepgramStt({ apiKey: env.DEEPGRAM_API_KEY, model: c.model });
  }
}

export function createTtsProvider(c: Choice<TtsName>, env: Env = process.env): TtsProvider {
  switch (c.provider) {
    case "openai":
      return openaiTts({ apiKey: env.OPENAI_API_KEY, model: c.model, voice: c.voice });
    case "elevenlabs":
      return elevenLabsTts({
        apiKey: env.ELEVEN_API_KEY,
        model: c.model,
        voiceId: c.voice || env.ELEVENLABS_VOICE_ID,
      });
    case "cartesia":
      return cartesiaTts({
        apiKey: env.CARTESIA_API_KEY,
        model: c.model,
        voice: c.voice || env.CARTESIA_VOICE_ID,
        voicePt: env.CARTESIA_VOICE_ID_PT,
      });
  }
}

/** Build the providers for a room from the three levels (room > user/product > server default). */
export function providersFromLevels(levels: ProviderLevels, env: Env = process.env): ProviderSet {
  const c = resolveProviderChoice({
    ...levels,
    server: levels.server ?? serverProviderChoice(env),
  });
  return {
    stt: createSttProvider(c.stt, env),
    llm: createLlmProvider(c.llm, env),
    tts: createTtsProvider(c.tts, env),
  };
}
