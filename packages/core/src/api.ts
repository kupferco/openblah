import type { Role } from "./protocol.js";

/** Consent wording and version, as the server returns it. Show `text` as is. */
export interface ConsentText {
  version: string;
  text: string;
}

/** What a guest sees before joining: from `GET /v1/invites/:token`. */
export interface InvitePreview {
  hostDisplayName: string;
  agent: "on" | "off" | "ask";
  agentName: string;
  consent: ConsentText;
}

/** The consent a person gives when joining; `textVersion` comes from the text they were shown. */
export interface ConsentGrant {
  accepted: true;
  textVersion: string;
}

export interface Invite {
  id: string;
  roomId: string;
  token: string;
  /** Link to share. */
  url: string;
  expiresAt: string;
  maxUses: number;
}

export interface CreateInviteOptions {
  expiresInSeconds?: number;
  maxUses?: number;
}

/** Result of joining with an invite link. Pass `token` and `livekitUrl` to `connect`. */
export interface GuestJoin {
  token: string;
  roomId: string;
  userId: string;
  role: "guest";
  expiresIn: number;
  livekitUrl?: string;
}

export interface RoomParticipant {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
  /** Hosts and members only. */
  contact?: string;
}

export interface ConsentStatus extends ConsentText {
  agentName: string;
  /** People in the room who have not consented to the current text. */
  missing: { userId: string; displayName: string }[];
}

/** A saved MCP server connection. Tokens are never returned. */
export interface McpConnection {
  id: string;
  serverUrl: string;
  name: string;
  /** `pending` until the person has consented in the browser. */
  status: "pending" | "connected" | "error";
  error?: string;
  scope?: string;
  createdAt: string;
  connectedAt?: string;
}

export interface StartMcpConnectionOptions {
  /** The person's id in your product. Leave out for the standalone app (Firebase sign-in). */
  userId?: string;
  name?: string;
  /** Only the scopes you need; the server's own default when left out. */
  scope?: string;
  /** Where the browser goes after consent. Must be allowed in the server's settings. */
  returnUrl?: string;
}

export interface OpenBlahApiOptions {
  /** Server base URL including `/v1`, e.g. `https://api.example.com/v1`. */
  baseUrl: string;
  /**
   * Headers for the endpoints that need the host app's credentials (everything
   * except joining by invite). The API key belongs to the host app's backend:
   * point `baseUrl` at a proxy there that adds it, or return it here only in a
   * trusted environment. Never ship the key in a public web bundle.
   */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

/** Error from the server: `status` is the HTTP status, `message` the server's `error` text. */
export class OpenBlahApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "OpenBlahApiError";
  }
}

/** Typed calls to the OpenBlah server's invite, consent and host-control endpoints. */
export class OpenBlahApi {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: OpenBlahApiOptions) {
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.doFetch = options.fetch ?? ((...a) => fetch(...a));
  }

  // ---- Host: invites ----

  createInvite(roomId: string, actorUserId: string, opts: CreateInviteOptions = {}) {
    return this.call<Invite>("POST", `/rooms/${enc(roomId)}/invites`, {
      body: { actorUserId, ...opts },
      auth: true,
    });
  }

  revokeInvite(roomId: string, inviteId: string, actorUserId: string) {
    return this.call<{ id: string; revoked: true }>(
      "DELETE",
      `/rooms/${enc(roomId)}/invites/${enc(inviteId)}`,
      { query: { actorUserId }, auth: true },
    );
  }

  // ---- Host: controls ----

  removeParticipant(roomId: string, userId: string, actorUserId: string) {
    return this.call<{ userId: string; removed: true }>(
      "DELETE",
      `/rooms/${enc(roomId)}/participants/${enc(userId)}`,
      { query: { actorUserId }, auth: true },
    );
  }

  endRoom(roomId: string, actorUserId: string) {
    return this.call<{ id: string; ended: true }>("POST", `/rooms/${enc(roomId)}/end`, {
      body: { actorUserId },
      auth: true,
    });
  }

  listParticipants(roomId: string, viewerUserId: string) {
    return this.call<{ participants: RoomParticipant[] }>(
      "GET",
      `/rooms/${enc(roomId)}/participants`,
      { query: { viewerUserId }, auth: true },
    ).then((r) => r.participants);
  }

  // ---- Consent ----

  getConsent(roomId: string, userId: string) {
    return this.call<ConsentStatus>("GET", `/rooms/${enc(roomId)}/consent`, {
      query: { userId },
      auth: true,
    });
  }

  giveConsent(roomId: string, userId: string, textVersion: string) {
    return this.call<{ roomId: string; userId: string; textVersion: string; consentedAt: string }>(
      "POST",
      `/rooms/${enc(roomId)}/consent`,
      { body: { userId, accepted: true, textVersion }, auth: true },
    );
  }

  // ---- Guests (public endpoints, no credentials) ----

  getInvite(token: string) {
    return this.call<InvitePreview>("GET", `/invites/${enc(token)}`);
  }

  joinWithInvite(token: string, displayName: string, consent: ConsentGrant | null) {
    return this.call<GuestJoin>("POST", `/invites/${enc(token)}/join`, {
      body: consent ? { displayName, consent } : { displayName },
    });
  }

  // ---- MCP connections (OAuth) ----

  private mcpBase(userId?: string): string {
    return userId ? `/users/${enc(userId)}/mcp/connections` : "/me/mcp/connections";
  }

  /** Start connecting an MCP server; open `authorizationUrl` for the person to consent. */
  startMcpConnection(url: string, opts: StartMcpConnectionOptions = {}) {
    const { userId, ...rest } = opts;
    return this.call<{ id: string; authorizationUrl: string }>("POST", this.mcpBase(userId), {
      body: { url, ...rest },
      auth: true,
    });
  }

  listMcpConnections(userId?: string) {
    return this.call<{ connections: McpConnection[] }>("GET", this.mcpBase(userId), {
      auth: true,
    }).then((r) => r.connections);
  }

  getMcpConnection(id: string, userId?: string) {
    return this.call<McpConnection>("GET", `${this.mcpBase(userId)}/${enc(id)}`, { auth: true });
  }

  testMcpConnection(id: string, userId?: string) {
    return this.call<{ ok: boolean; message: string }>(
      "POST",
      `${this.mcpBase(userId)}/${enc(id)}/test`,
      { auth: true },
    );
  }

  /** Disconnect; the server deletes the stored tokens. */
  async disconnectMcp(id: string, userId?: string): Promise<void> {
    await this.call<null>("DELETE", `${this.mcpBase(userId)}/${enc(id)}`, { auth: true });
  }

  private async call<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string>; auth?: boolean } = {},
  ): Promise<T> {
    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.auth) Object.assign(headers, await this.options.headers?.());
    const res = await this.doFetch(`${this.base}${path}${qs}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const msg =
        typeof data === "object" && data && "error" in data && typeof data.error === "string"
          ? data.error
          : `request failed (${res.status})`;
      throw new OpenBlahApiError(res.status, msg, data);
    }
    return data as T;
  }
}

const enc = encodeURIComponent;
