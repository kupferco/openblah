import * as google from "@livekit/agents-plugin-google";
import type { LlmProvider } from "./types.js";

/**
 * Gemini Flash through the LiveKit Google plugin (streaming, tool calls and
 * usage included). Alternatives: OpenAI and Anthropic plugins, wired in T16.
 */
export function geminiLlm(opts: { apiKey?: string; model?: string } = {}): LlmProvider {
  return {
    name: "gemini",
    createLlm: () =>
      new google.LLM({
        apiKey: opts.apiKey,
        model: opts.model ?? "gemini-2.5-flash",
        temperature: 0.6,
        // Short voice replies: cap output length.
        maxOutputTokens: 400,
        // Skip hidden reasoning for speed in Direct mode.
        thinkingConfig: { thinkingBudget: 0 },
      }),
  };
}
