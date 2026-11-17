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
 */
export function defaultProviders(env: Env = process.env): ProviderSet {
  return providersFromLevels({}, env);
}
