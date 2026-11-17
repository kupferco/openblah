import * as anthropic from "@livekit/agents-plugin-anthropic";
import type { LlmProvider } from "./types.js";

/** Default Claude model: the fastest tier, for voice. Override with ANTHROPIC_MODEL. */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

/** Claude's `input_schema` must be a JSON Schema object; drop the meta keywords it does not use. */
export function claudeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const rest = Object.fromEntries(
    Object.entries(schema).filter(([k]) => k !== "$schema" && k !== "$id"),
  );
  return { ...rest, type: "object", properties: (rest.properties as object | undefined) ?? {} };
}

export function claudeLlm(
  opts: { apiKey?: string; model?: string; baseUrl?: string } = {},
): LlmProvider {
  const model = opts.model || DEFAULT_CLAUDE_MODEL;
  return {
    name: "claude",
    formatToolSchema: claudeToolSchema,
    createLlm: () =>
      new anthropic.LLM({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl,
        model,
        temperature: 0.6,
        maxTokens: 400,
      }),
  };
}
