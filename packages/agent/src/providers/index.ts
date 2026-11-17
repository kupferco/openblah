import { cartesiaTts } from "./cartesia.js";
import { deepgramStt } from "./deepgram.js";
import { DEFAULT_GEMINI_MODEL, geminiLlm, geminiThinkingConfig } from "./gemini.js";
import type { ProviderSet } from "./types.js";

export * from "./types.js";
export { cartesiaTts, deepgramStt, DEFAULT_GEMINI_MODEL, geminiLlm, geminiThinkingConfig };

type Env = Record<string, string | undefined>;

/** Default providers (Deepgram, Gemini Flash, Cartesia) from environment keys. */
export function defaultProviders(
  env: Env = process.env,
  keys?: { gemini: string; deepgram: string; cartesia: string },
): ProviderSet {
  if (keys) {
    return {
      stt: deepgramStt({ apiKey: keys.deepgram }),
      llm: geminiLlm({ apiKey: keys.gemini }),
      tts: cartesiaTts({ apiKey: keys.cartesia, voice: env.CARTESIA_VOICE_ID }),
    };
  }
  return {
    stt: deepgramStt({ apiKey: env.DEEPGRAM_API_KEY }),
    llm: geminiLlm({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    tts: cartesiaTts({ apiKey: env.CARTESIA_API_KEY, voice: env.CARTESIA_VOICE_ID }),
  };
}
