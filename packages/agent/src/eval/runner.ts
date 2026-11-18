import { llm } from "@livekit/agents";
import { directInstructions } from "../config.js";
import { connectMcp } from "../mcp/client.js";
import { MCP_INSTRUCTIONS } from "../mcp/tools.js";
import type { LlmProvider } from "../providers/types.js";
import type { EvalCase } from "./cases.js";
import { type CaseResult, type ModelCall, scoreCall } from "./score.js";

/** Build the tool context from the fake MCP server through the adapter's schema conversion. */
export async function loadTools(provider: LlmProvider, url: string) {
  const conn = await connectMcp(url);
  const infos = await conn.listTools();
  const tools: Record<string, unknown> = {};
  for (const t of infos) {
    tools[t.name] = llm.tool({
      description: t.description,
      parameters: (provider.formatToolSchema?.(t.inputSchema) ?? t.inputSchema) as never,
      // The eval only looks at which call the model asks for; it never runs it.
      execute: async () => "ok",
    });
  }
  return { tools: tools as never, close: () => conn.close() };
}

/** Run one case: stream the reply and time the first chunk and the first tool call. */
export async function runCase(
  model: llm.LLM,
  tools: llm.ToolContextLike,
  c: EvalCase,
): Promise<CaseResult> {
  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({
    role: "system",
    content: `${directInstructions({ agentName: "Blah" })} ${MCP_INSTRUCTIONS} Today is 2026-03-01.`,
  });
  chatCtx.addMessage({ role: "user", content: c.text });
  const t0 = performance.now();
  let firstMs = NaN;
  let toolMs = NaN;
  const calls: ModelCall[] = [];
  let tokens: number | undefined;
  try {
    const stream = model.chat({ chatCtx, toolCtx: tools });
    for await (const chunk of stream) {
      const now = performance.now() - t0;
      if (Number.isNaN(firstMs) && chunk.delta) firstMs = now;
      if (chunk.delta?.toolCalls?.length) {
        if (Number.isNaN(toolMs)) toolMs = now;
        for (const tc of chunk.delta.toolCalls) calls.push({ name: tc.name, args: tc.args });
      }
      if (chunk.usage) tokens = chunk.usage.totalTokens;
    }
    const end = performance.now() - t0;
    return {
      id: c.id,
      ok: scoreCall(c.expect, calls),
      toolMs: Number.isNaN(toolMs) ? end : toolMs,
      firstMs: Number.isNaN(firstMs) ? end : firstMs,
      calls,
      tokens,
    };
  } catch (err) {
    return {
      id: c.id,
      ok: false,
      toolMs: NaN,
      firstMs: NaN,
      calls,
      error: err instanceof Error ? err.message.slice(0, 200) : "failed",
    };
  }
}
