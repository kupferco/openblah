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

/** A room's vendor keys; OpenAI and Claude are present when the owner has one for them. */
export interface RoomVendorKeys {
  gemini: string;
  deepgram: string;
  cartesia: string;
  openai?: string;
  claude?: string;
}

/**
 * Providers from the environment alone (server default level). Gemini, Deepgram
 * and Cartesia unless OPENBLAH_LLM_PROVIDER / _STT_ / _TTS_ say otherwise.
 * Keys for the room (trial or user keys) replace the environment's for those vendors.
 */
export function defaultProviders(env: Env = process.env, keys?: RoomVendorKeys): ProviderSet {
  return providersFromLevels({}, withRoomKeys(env, keys));
}

/** The environment with a room's own vendor keys laid over it. */
export function withRoomKeys(env: Env, keys?: RoomVendorKeys): Env {
  if (!keys) return env;
  return {
    ...env,
    GEMINI_API_KEY: keys.gemini,
    DEEPGRAM_API_KEY: keys.deepgram,
    CARTESIA_API_KEY: keys.cartesia,
    ...(keys.openai ? { OPENAI_API_KEY: keys.openai } : {}),
    ...(keys.claude ? { ANTHROPIC_API_KEY: keys.claude } : {}),
  };
}
