import * as google from "@livekit/agents-plugin-google";
import type { LlmProvider } from "./types.js";

/** Default Gemini model; override with the GEMINI_MODEL env var. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

type ThinkingConfig = NonNullable<
  NonNullable<ConstructorParameters<typeof google.LLM>[0]>["thinkingConfig"]
>;

/**
 * Keep hidden reasoning short for fast voice replies. Gemini 3 models take a
 * thinking level, not a budget; left unset, the plugin picks MINIMAL for Flash,
 * which gemini-3.8-flash rejects. Other models keep their default.
 */
export function geminiThinkingConfig(model: string): ThinkingConfig | undefined {
  if (!/gemini-3/i.test(model)) return undefined;
  // The @google/genai ThinkingLevel enum value; that package is not a direct dependency.
  return { thinkingLevel: "LOW" as ThinkingConfig["thinkingLevel"] };
}

/**
 * Gemini Flash through the LiveKit Google plugin (streaming, tool calls and
 * usage included). Alternatives: OpenAI and Anthropic plugins, wired in T16.
 */
export function geminiLlm(opts: { apiKey?: string; model?: string } = {}): LlmProvider {
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  return {
    name: "gemini",
    createLlm: () =>
      new google.LLM({
        apiKey: opts.apiKey,
        model,
        temperature: 0.6,
        // Short voice replies: cap output length.
        maxOutputTokens: 400,
        thinkingConfig: geminiThinkingConfig(model),
      }),
  };
}
