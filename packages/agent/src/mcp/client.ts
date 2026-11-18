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
/** `refresh: true` asks for a new token because the server rejected the last one. */
export type McpTokenProvider = (opts?: { refresh?: boolean }) => Promise<string>;

/**
 * `token` is a fixed bearer token, or a function called for every request so a
 * refreshed OAuth token is picked up without reconnecting.
 */
export async function connectMcp(
  url: string,
  token?: string | McpTokenProvider,
): Promise<McpConnection> {
  const requestInit =
    typeof token === "string" ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  const dynamicFetch =
    typeof token === "function"
      ? async (input: string | URL, init?: RequestInit) => {
          const send = async (refresh: boolean) => {
            const headers = new Headers(init?.headers);
            headers.set(
              "Authorization",
              `Bearer ${await token(refresh ? { refresh } : undefined)}`,
            );
            return fetch(input, { ...init, headers });
          };
          const res = await send(false);
          if (res.status !== 401) return res;
          // The server may have expired or revoked the token early: refresh once and retry.
          await res.body?.cancel().catch(() => undefined);
          return send(true);
        }
      : undefined;
  const options = { requestInit, ...(dynamicFetch ? { fetch: dynamicFetch } : {}) };
  const target = new URL(url);
  const make = async (transport: Transport): Promise<Client> => {
    const client = new Client({ name: "openblah-agent", version: "0.0.0" });
    await client.connect(transport);
    return client;
  };
  let client: Client;
  try {
    client = await make(new StreamableHTTPClientTransport(target, options));
  } catch {
    client = await make(new SSEClientTransport(target, options));
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
