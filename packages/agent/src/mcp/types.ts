/** One MCP server a room may call (Streamable HTTP, with SSE fallback; no stdio). */
export interface McpServerConfig {
  /** Short id used to prefix tool names when two servers share a tool name. */
  id: string;
  url: string;
  /**
   * Participant who owns the connection. Their credentials are used and only
   * their requests may trigger calls. Defaults to the room's `ownerId`.
   */
  ownerId?: string;
  /** Host-passed token of the embedding product's logged-in user, sent as the bearer token. */
  userToken?: string;
}

/** Per-room MCP setup, passed by the host at room creation (job metadata). */
export interface McpRoomConfig {
  servers: McpServerConfig[];
  /** Host allow-list of tool names (prompt size). Absent = all read-only tools. */
  allowTools?: string[];
  /** Participant that owns connections that name no owner (the host). */
  ownerId?: string;
  /** Token the host passes for its logged-in user; used for servers without their own. */
  userToken?: string;
}

export type ActionStatus = "ok" | "error" | "blocked" | "denied";

/** One entry of the action log, stored with the room. */
export interface ActionLogEntry {
  at: string;
  roomId: string;
  /** Who asked (participant identity). */
  askedBy: string;
  /** Whose credentials were used. */
  ownerId: string;
  serverId: string;
  tool: string;
  arguments: Record<string, unknown>;
  status: ActionStatus;
  /** Short result or reason, never a token. */
  detail?: string;
}

export interface ActionLog {
  record(entry: ActionLogEntry): void | Promise<void>;
}

/** Parse the room's MCP config out of the dispatch job metadata (JSON). */
export function parseMcpConfig(metadata: string | undefined): McpRoomConfig | undefined {
  if (!metadata) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(metadata);
  } catch {
    return undefined;
  }
  const mcp = (raw as { mcp?: unknown } | null)?.mcp as Partial<McpRoomConfig> | undefined;
  if (!mcp || !Array.isArray(mcp.servers)) return undefined;
  const servers = mcp.servers.filter(
    (s): s is McpServerConfig =>
      !!s && typeof s.id === "string" && typeof s.url === "string" && /^https?:\/\//.test(s.url),
  );
  if (servers.length === 0) return undefined;
  return {
    servers,
    allowTools: Array.isArray(mcp.allowTools)
      ? mcp.allowTools.filter((t) => typeof t === "string")
      : undefined,
    ownerId: typeof mcp.ownerId === "string" ? mcp.ownerId : undefined,
    userToken: typeof mcp.userToken === "string" ? mcp.userToken : undefined,
  };
}
