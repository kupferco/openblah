import { createServer, type Server } from "node:http";

/** A tool as the fake Housekeeper MCP server lists it. */
export interface FakeTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean };
}

export const FAKE_TOOLS: FakeTool[] = [
  {
    name: "list_tasks",
    description: "List the user's household tasks",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_task",
    description: "Add a household task",
    inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    // No readOnlyHint: counts as a write, so the owner must confirm it.
  },
  {
    name: "delete_account",
    description: "Delete the user's account",
    inputSchema: { type: "object", properties: {} },
  },
];

/**
 * A minimal fake MCP server (JSON-RPC over HTTP POST) for local runs and tests. It only
 * accepts `Authorization: Bearer <token>` for tokens in `tokens` (token -> user id), the same
 * way Housekeeper's real MCP server is expected to trust the logged-in user's token.
 */
export function createFakeMcpServer(tokens: Record<string, string>): {
  server: Server;
  calls: { user: string; tool: string; args: unknown }[];
  start(port?: number): Promise<string>;
  stop(): Promise<void>;
} {
  const calls: { user: string; tool: string; args: unknown }[] = [];
  const tasks: Record<string, string[]> = {};
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      const user = tokens[/^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? ""];
      if (!user) return send(401, { error: "invalid token" });
      let msg: { id?: number; method?: string; params?: { name?: string; arguments?: unknown } };
      try {
        msg = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return send(400, { error: "bad json" });
      }
      const ok = (result: unknown) => send(200, { jsonrpc: "2.0", id: msg.id, result });
      if (msg.method === "initialize") {
        return ok({
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-housekeeper", version: "0.0.0" },
        });
      }
      if (msg.method === "tools/list") return ok({ tools: FAKE_TOOLS });
      if (msg.method === "tools/call") {
        const tool = msg.params?.name ?? "";
        const args = msg.params?.arguments;
        calls.push({ user, tool, args });
        const mine = (tasks[user] ??= []);
        if (tool === "add_task") mine.push(String((args as { title?: string })?.title ?? ""));
        return ok({ content: [{ type: "text", text: JSON.stringify(mine) }] });
      }
      return send(200, {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "method not found" },
      });
    });
  });
  return {
    server,
    calls,
    start: (port = 0) =>
      new Promise((resolve) =>
        server.listen(port, "127.0.0.1", () => {
          const addr = server.address();
          resolve(`http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : port}/mcp`);
        }),
      ),
    stop: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
