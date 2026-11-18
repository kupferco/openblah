import type { llm } from "@livekit/agents";
import { connectMcp, type McpConnection, type McpTokenProvider } from "./client.js";
import { buildMcpTools, type ConnectedServer, type McpVoiceHooks } from "./tools.js";
import type { ActionLog, McpRoomConfig } from "./types.js";
import type { LlmProvider } from "../providers/types.js";

export interface McpRoom {
  tools: llm.ToolContextLike;
  close(): Promise<void>;
}

/** Connect the room's servers (one failing server does not stop the others) and build tools. */
export async function openMcpRoom(opts: {
  roomId: string;
  config: McpRoomConfig;
  provider: Pick<LlmProvider, "formatToolSchema">;
  log: ActionLog;
  hooks: McpVoiceHooks;
  connect?: (url: string, token?: string | McpTokenProvider) => Promise<McpConnection>;
  /** Fetches a saved connection's current token from the server (OAuth connections). */
  fetchToken?: (ownerId: string, connectionId: string, refresh?: boolean) => Promise<string>;
}): Promise<McpRoom> {
  const connect = opts.connect ?? connectMcp;
  const servers: ConnectedServer[] = [];
  for (const s of opts.config.servers) {
    try {
      const ownerId = s.ownerId ?? opts.config.ownerId ?? "";
      const { fetchToken } = opts;
      const token: string | McpTokenProvider | undefined =
        s.connectionId && fetchToken
          ? (o) => fetchToken(ownerId, s.connectionId as string, o?.refresh)
          : (s.userToken ?? opts.config.userToken);
      const connection = await connect(s.url, token);
      servers.push({
        id: s.id,
        ownerId,
        connection,
        tools: await connection.listTools(),
      });
    } catch {
      // Never log the URL query or token; the server is simply unavailable.
      console.error(
        JSON.stringify({ event: "mcp_connect_failed", roomId: opts.roomId, server: s.id }),
      );
    }
  }
  return {
    tools: buildMcpTools({ ...opts, servers }) as unknown as llm.ToolContextLike,
    close: async () => {
      await Promise.allSettled(servers.map((s) => s.connection.close()));
    },
  };
}
