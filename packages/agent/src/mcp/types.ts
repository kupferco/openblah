import { isAllowedWebhookUrl } from "./webhook.js";

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
  /**
   * A saved OAuth connection of the owner. The token is fetched from the
   * OpenBlah server when needed; it never travels in the room config.
   */
  connectionId?: string;
  /** Host-passed token of the embedding product's logged-in user, sent as the bearer token. */
  userToken?: string;
}

/** A webhook tool: a JSON-schema definition plus a callback URL, for apps that don't run MCP. */
export interface WebhookToolConfig {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  /** Called with a signed POST. https only (http for loopback). */
  url: string;
  /** HMAC secret shared with the receiver. Server-side only; never logged. */
  secret: string;
  timeoutMs?: number;
  /** Treated as read-only (runs without confirmation). Default false: confirmation needed. */
  readOnly?: boolean;
  /** Participant who owns the credentials. Defaults to the room's `ownerId`. */
  ownerId?: string;
}

/** Per-room MCP setup, passed by the host at room creation (job metadata). */
export interface McpRoomConfig {
  servers: McpServerConfig[];
  /** Host allow-list of tool names (prompt size). Absent = all read-only tools. */
  allowTools?: string[];
  /** Webhook tools passed at room creation. Same confirmation rules as MCP tools. */
  webhookTools?: WebhookToolConfig[];
  /** Host override per tool name: "read" runs freely, "write" needs confirmation. Beats the annotations. */
  toolOverrides?: Record<string, "read" | "write">;
  /** Participant that owns connections that name no owner (the host). */
  ownerId?: string;
  /** Token the host passes for its logged-in user; used for servers without their own. */
  userToken?: string;
}

export type ActionStatus =
  | "ok"
  | "error"
  | "blocked"
  | "denied"
  /** A write action waiting for the owner's confirmation. */
  | "pending"
  /** The owner said no, or the confirmation timed out. */
  | "declined";

/** How the owner confirmed a write action. */
export interface ConfirmationEvidence {
  via: "voice" | "tap";
  /** Participant who confirmed (the tool owner). */
  by: string;
  at: string;
  approvalId: string;
  /** What was read back / shown for confirmation. */
  summary: string;
}

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
  /** Present on confirmed write actions. */
  confirmation?: ConfirmationEvidence;
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
  if (!mcp) return undefined;
  const servers = (mcp.servers ?? []).filter(
    (s): s is McpServerConfig =>
      !!s && typeof s.id === "string" && typeof s.url === "string" && /^https?:\/\//.test(s.url),
  );
  const webhookTools = (Array.isArray(mcp.webhookTools) ? mcp.webhookTools : []).filter(
    (t): t is WebhookToolConfig =>
      !!t &&
      typeof t.name === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/.test(t.name) &&
      typeof t.description === "string" &&
      typeof t.url === "string" &&
      isAllowedWebhookUrl(t.url) &&
      typeof t.secret === "string" &&
      t.secret.length > 0,
  );
  if (servers.length === 0 && webhookTools.length === 0) return undefined;
  const overrides = mcp.toolOverrides;
  return {
    servers,
    webhookTools,
    toolOverrides:
      overrides && typeof overrides === "object"
        ? Object.fromEntries(
            Object.entries(overrides).filter(([, v]) => v === "read" || v === "write"),
          )
        : undefined,
    allowTools: Array.isArray(mcp.allowTools)
      ? mcp.allowTools.filter((t) => typeof t === "string")
      : undefined,
    ownerId: typeof mcp.ownerId === "string" ? mcp.ownerId : undefined,
    userToken: typeof mcp.userToken === "string" ? mcp.userToken : undefined,
  };
}
