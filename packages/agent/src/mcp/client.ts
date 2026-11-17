import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface McpCallResult {
  isError: boolean;
  text: string;
}

/** A connection to one MCP server. */
export interface McpConnection {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

/**
 * Connect over Streamable HTTP (MCP spec 2025-03-26 and later); if the server
 * does not speak it, fall back to the older HTTP+SSE transport. The token is
 * sent as a bearer token. stdio is deliberately not supported.
 */
export async function connectMcp(url: string, token?: string): Promise<McpConnection> {
  const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  const target = new URL(url);
  const make = async (transport: Transport): Promise<Client> => {
    const client = new Client({ name: "openblah-agent", version: "0.0.0" });
    await client.connect(transport);
    return client;
  };
  let client: Client;
  try {
    client = await make(new StreamableHTTPClientTransport(target, { requestInit }));
  } catch {
    client = await make(new SSEClientTransport(target, { requestInit }));
  }
  return {
    async listTools() {
      const out: McpToolInfo[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const t of page.tools) {
          out.push({
            name: t.name,
            description: t.description ?? "",
            inputSchema: t.inputSchema as Record<string, unknown>,
            readOnlyHint: t.annotations?.readOnlyHint,
            destructiveHint: t.annotations?.destructiveHint,
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    },
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args });
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content
        .map((c: { type: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : ""))
        .filter(Boolean)
        .join("\n");
      return { isError: res.isError === true, text };
    },
    close: () => client.close(),
  };
}
