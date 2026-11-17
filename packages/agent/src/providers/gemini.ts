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
 * usage included). The OpenAI and Claude adapters sit beside it (openai.ts, anthropic.ts).
 */
export function geminiLlm(
  opts: { apiKey?: string; model?: string; baseUrl?: string } = {},
): LlmProvider {
  const model = opts.model || DEFAULT_GEMINI_MODEL;
  return {
    name: "gemini",
    formatToolSchema: geminiToolSchema,
    createLlm: () =>
      new google.LLM({
        apiKey: opts.apiKey,
        model,
        temperature: 0.6,
        // Short voice replies: cap output length.
        maxOutputTokens: 400,
        thinkingConfig: geminiThinkingConfig(model),
        ...(opts.baseUrl ? { httpOptions: { baseUrl: opts.baseUrl } } : {}),
      }),
  };
}
