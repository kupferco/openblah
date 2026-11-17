import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Test support: tiny local servers that speak each vendor's streaming wire
 * format and answer every request with one tool call (`get_weather`,
 * `{ "city": "Lisbon" }`) plus token usage. They let the contract tests run the
 * real adapters without keys or network. With `hang`, the server sends the
 * first chunk and then stalls, to test cancel.
 */
export type Vendor = "openai" | "anthropic" | "gemini";

export interface FakeVendor {
  baseUrl: string;
  requests: Array<{ url: string; body: Record<string, unknown> }>;
  close(): Promise<void>;
}

const sse = (res: ServerResponse, data: unknown, event?: string) =>
  res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`);

function openaiChunks(res: ServerResponse, hang: boolean) {
  const base = { id: "c1", object: "chat.completion.chunk", created: 1, model: "m" };
  sse(res, {
    ...base,
    choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
  });
  if (hang) return;
  sse(res, {
    ...base,
    choices: [
      {
        index: 0,
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "get_weather", arguments: '{"city":' },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  });
  sse(res, {
    ...base,
    choices: [
      {
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '"Lisbon"}' } }] },
        finish_reason: null,
      },
    ],
  });
  sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  sse(res, {
    ...base,
    choices: [],
    usage: { prompt_tokens: 20, completion_tokens: 7, total_tokens: 27 },
  });
  res.write("data: [DONE]\n\n");
}

function anthropicChunks(res: ServerResponse, hang: boolean) {
  sse(
    res,
    {
      type: "message_start",
      message: {
        id: "m1",
        type: "message",
        role: "assistant",
        model: "m",
        content: [],
        stop_reason: null,
        usage: { input_tokens: 20, output_tokens: 1 },
      },
    },
    "message_start",
  );
  if (hang) return;
  sse(
    res,
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "tool_use", id: "tu_1", name: "get_weather", input: {} },
    },
    "content_block_start",
  );
  for (const part of ['{"city":', ' "Lisbon"}']) {
    sse(
      res,
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: part },
      },
      "content_block_delta",
    );
  }
  sse(res, { type: "content_block_stop", index: 0 }, "content_block_stop");
  sse(
    res,
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use", stop_sequence: null },
      usage: { output_tokens: 7 },
    },
    "message_delta",
  );
  sse(res, { type: "message_stop" }, "message_stop");
}

function geminiChunks(res: ServerResponse, hang: boolean) {
  sse(res, { candidates: [{ content: { role: "model", parts: [{ text: "" }] } }] });
  if (hang) return;
  sse(res, {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ functionCall: { name: "get_weather", args: { city: "Lisbon" } } }],
        },
        finishReason: "STOP",
      },
    ],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7, totalTokenCount: 27 },
  });
}

export async function startFakeVendor(vendor: Vendor, hang = false): Promise<FakeVendor> {
  const requests: FakeVendor["requests"] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests.push({ url: req.url ?? "", body: raw ? JSON.parse(raw) : {} });
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      if (vendor === "openai") openaiChunks(res, hang);
      else if (vendor === "anthropic") anthropicChunks(res, hang);
      else geminiChunks(res, hang);
      if (!hang) res.end();
    });
    res.on("close", () => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: vendor === "openai" ? `http://127.0.0.1:${port}/v1` : `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
