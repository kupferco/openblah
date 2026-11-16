import * as google from "@livekit/agents-plugin-google";
import type { LlmProvider } from "./types.js";

/** Keywords Gemini function declarations reject. */
const GEMINI_UNSUPPORTED = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "definitions",
  "additionalProperties",
  "patternProperties",
  "propertyNames",
  "const",
  "not",
  "if",
  "then",
  "else",
  "exclusiveMinimum",
  "exclusiveMaximum",
]);

/** Reduce an MCP JSON schema to the OpenAPI-style subset Gemini accepts. */
export function geminiToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (GEMINI_UNSUPPORTED.has(k)) continue;
      if (k === "type" && Array.isArray(v)) {
        // ["string","null"] -> "string"
        out[k] = v.find((t) => t !== "null") ?? "string";
        continue;
      }
      // Property names are free-form: only recurse into their schemas.
      out[k] = k === "properties" && v && typeof v === "object" ? walkProps(v) : walk(v);
    }
    return out;
  };
  const walkProps = (props: object) =>
    Object.fromEntries(Object.entries(props).map(([n, v]) => [n, walk(v)]));
  const result = walk(schema) as Record<string, unknown>;
  return { type: "object", properties: {}, ...result };
}

/**
 * Gemini Flash through the LiveKit Google plugin (streaming, tool calls and
 * usage included). Alternatives: OpenAI and Anthropic plugins, wired in T16.
 */
export function geminiLlm(opts: { apiKey?: string; model?: string } = {}): LlmProvider {
  return {
    name: "gemini",
    formatToolSchema: geminiToolSchema,
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
