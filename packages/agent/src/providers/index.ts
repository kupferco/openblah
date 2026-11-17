import { claudeLlm, claudeToolSchema, DEFAULT_CLAUDE_MODEL } from "./anthropic.js";
import { assemblyAiStt } from "./assemblyai.js";
import { cartesiaTts } from "./cartesia.js";
import { deepgramStt } from "./deepgram.js";
import {
  DEFAULT_GEMINI_MODEL,
  geminiLlm,
  geminiThinkingConfig,
  geminiToolSchema,
} from "./gemini.js";
import { elevenLabsTts } from "./elevenlabs.js";
import {
  DEFAULT_OPENAI_MODEL,
  openaiLlm,
  openaiStt,
  openaiToolSchema,
  openaiTts,
} from "./openai.js";
import { providersFromLevels } from "./select.js";
import type { ProviderSet } from "./types.js";

export * from "./types.js";
export * from "./select.js";
export {
  assemblyAiStt,
  cartesiaTts,
  claudeLlm,
  claudeToolSchema,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  elevenLabsTts,
  openaiLlm,
  openaiStt,
  openaiToolSchema,
  openaiTts,
  deepgramStt,
  DEFAULT_GEMINI_MODEL,
  geminiLlm,
  geminiThinkingConfig,
  geminiToolSchema,
};

type Env = Record<string, string | undefined>;

/**
 * Providers from the environment alone (server default level). Gemini, Deepgram
 * and Cartesia unless OPENBLAH_LLM_PROVIDER / _STT_ / _TTS_ say otherwise.
 * Keys for the room (trial or user keys) replace the environment's for those vendors.
 */
export function defaultProviders(
  env: Env = process.env,
  keys?: { gemini: string; deepgram: string; cartesia: string },
): ProviderSet {
  return providersFromLevels({}, withRoomKeys(env, keys));
}

/** The environment with a room's own vendor keys laid over it. */
export function withRoomKeys(
  env: Env,
  keys?: { gemini: string; deepgram: string; cartesia: string },
): Env {
  if (!keys) return env;
  return {
    ...env,
    GEMINI_API_KEY: keys.gemini,
    DEEPGRAM_API_KEY: keys.deepgram,
    CARTESIA_API_KEY: keys.cartesia,
  };
}
