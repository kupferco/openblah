import { cartesiaTts } from "./cartesia.js";
import { deepgramStt } from "./deepgram.js";
import { DEFAULT_GEMINI_MODEL, geminiLlm, geminiThinkingConfig } from "./gemini.js";
import type { ProviderSet } from "./types.js";

export * from "./types.js";
export { cartesiaTts, deepgramStt, DEFAULT_GEMINI_MODEL, geminiLlm, geminiThinkingConfig };

type Env = Record<string, string | undefined>;

/** Default providers (Deepgram, Gemini Flash, Cartesia) from environment keys. */
export function defaultProviders(env: Env = process.env): ProviderSet {
  return {
    stt: deepgramStt({ apiKey: env.DEEPGRAM_API_KEY }),
    llm: geminiLlm({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    tts: cartesiaTts({ apiKey: env.CARTESIA_API_KEY, voice: env.CARTESIA_VOICE_ID }),
  };
}
