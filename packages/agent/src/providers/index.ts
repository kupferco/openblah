import { cartesiaTts } from "./cartesia.js";
import { deepgramStt } from "./deepgram.js";
import { geminiLlm } from "./gemini.js";
import type { ProviderSet } from "./types.js";

export * from "./types.js";
export { cartesiaTts, deepgramStt, geminiLlm };

type Env = Record<string, string | undefined>;

/** Default providers (Deepgram, Gemini Flash, Cartesia) from environment keys. */
export function defaultProviders(env: Env = process.env): ProviderSet {
  return {
    stt: deepgramStt({ apiKey: env.DEEPGRAM_API_KEY }),
    llm: geminiLlm({ apiKey: env.GEMINI_API_KEY }),
    tts: cartesiaTts({ apiKey: env.CARTESIA_API_KEY, voice: env.CARTESIA_VOICE_ID }),
  };
}
