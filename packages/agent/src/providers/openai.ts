import * as openai from "@livekit/agents-plugin-openai";
import type { LlmProvider, SttProvider, TtsProvider } from "./types.js";

/** Default OpenAI chat model; override with OPENAI_MODEL. Check docs/providers.md for measured latency. */
export const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";

/** Keywords OpenAI's non-strict function parameters do not need. */
const OPENAI_DROPPED = new Set(["$schema", "$id"]);

/** MCP schemas are JSON Schema already; OpenAI takes them almost as is (non-strict mode). */
export function openaiToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !OPENAI_DROPPED.has(k))
        .map(([k, v]) => [
          k,
          k === "properties" && v && typeof v === "object"
            ? Object.fromEntries(Object.entries(v).map(([n, s]) => [n, walk(s)]))
            : walk(v),
        ]),
    );
  };
  return { type: "object", properties: {}, ...(walk(schema) as Record<string, unknown>) };
}

export function openaiLlm(
  opts: { apiKey?: string; model?: string; baseUrl?: string } = {},
): LlmProvider {
  const model = opts.model || DEFAULT_OPENAI_MODEL;
  return {
    name: "openai",
    formatToolSchema: openaiToolSchema,
    createLlm: () =>
      new openai.LLM({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl,
        model,
        temperature: 0.6,
        maxCompletionTokens: 400,
      }),
  };
}

/** OpenAI speech to text. `language` is left unset so English and Portuguese are both detected. */
export function openaiStt(opts: { apiKey?: string; model?: string } = {}): SttProvider {
  return {
    name: "openai",
    createStt: () =>
      new openai.STT({
        apiKey: opts.apiKey,
        model: opts.model ?? "gpt-4o-mini-transcribe",
        detectLanguage: true,
      }),
  };
}

/**
 * OpenAI text to speech. The voices are multilingual and follow the language of
 * the text, so `setLanguage` has nothing to switch.
 */
export function openaiTts(
  opts: { apiKey?: string; model?: string; voice?: string } = {},
): TtsProvider {
  return {
    name: "openai",
    createTts: () =>
      new openai.TTS({
        apiKey: opts.apiKey,
        model: opts.model ?? "gpt-4o-mini-tts",
        voice: (opts.voice ?? "coral") as openai.TTSOptions["voice"],
      }),
    setLanguage() {},
  };
}
