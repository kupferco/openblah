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

/** A non-host asked for the agent; the host approves or declines it. */
export interface AgentRequestInfo {
  id: string;
  userId: string;
  displayName: string;
  requestedAt: string;
}

/**
 * The room's agent setting and what is pending. `agent` is `off` (a plain call), `on`, or `ask`
 * (off until someone invites it).
 */
export interface AgentControlState {
  agent: "on" | "off" | "ask";
  agentName: string;
  /** Any participant may bring the agent in or send it out, not only the host. */
  anyoneCanAddAgent: boolean;
  /** The agent leaves after this many seconds of silence. */
  idleTimeoutSeconds: number;
  /** The agent is on but waits for everyone to consent; it listens to nobody until then. */
  awaitingConsent: boolean;
  /** Who has not consented yet (only while awaiting consent). */
  missing: { userId: string; displayName: string }[];
  /** Pending requests; only the host sees them. */
  requests: AgentRequestInfo[];
  /** True when you may bring the agent in and send it out without asking. */
  canControl: boolean;
}

/**
 * What happened to a request to bring the agent in: it is `on`, `awaiting_consent` (asking
 * everyone again), `requested` (the host was asked) or `refused` (a cap, key or trial limit).
 */
export interface AgentBringInResult {
  status: "on" | "awaiting_consent" | "requested" | "refused";
  agent: "on" | "off" | "ask";
  missing?: { userId: string; displayName: string }[];
  error?: string;
}

export interface ConsentStatus extends ConsentText {
  agentName: string;
  /** People in the room who have not consented to the current text. */
  missing: { userId: string; displayName: string }[];
}

/** A model provider in the onboarding list. Show `copy`; the Gemini entry is `recommended`. */
export interface OnboardingProvider {
  id: "gemini" | "openai" | "claude";
  label: string;
  recommended: boolean;
  /** You saved a key for this provider. */
  hasKey: boolean;
  /** It can run now (own keys, the product's keys or the trial). */
  usable: boolean;
  keyMode?: "server" | "byok" | "product" | "trial";
  /** Keys still missing to use this provider with your own keys (speech keys are needed too). */
  missingKeys: KeyProviderName[];
  copy: string;
  /** Where to get a (free) key. */
  keyUrl?: string;
}

export type KeyProviderName = "gemini" | "deepgram" | "cartesia" | "openai" | "claude";

export interface TrialInfo {
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  available: boolean;
}

export interface ModelSettings {
  llm: { provider: "gemini" | "openai" | "claude"; model?: string };
  /** Which level decided: room, user, product, server or default. */
  source: string;
  usable: boolean;
  problem?: string;
  language: "en" | "pt" | "auto";
  agentName?: string;
}

export interface OnboardingInfo {
  /** Intro text that suggests the free Gemini key first. */
  intro: string;
  providers: OnboardingProvider[];
  trial: TrialInfo | null;
  trialAvailable: boolean;
  dataTerms: string;
  current: ModelSettings;
}

export interface KeyCheckResult {
  provider: KeyProviderName;
  /** `unchecked`: no cheap check exists for this vendor. `unreachable`: try again. */
  status: "valid" | "invalid" | "unchecked" | "unreachable";
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

  // ---- Optional agent (T18) ----

  getAgentState(roomId: string, actorUserId: string) {
    return this.call<AgentControlState>("GET", `/rooms/${enc(roomId)}/agent`, {
      query: { actorUserId },
      auth: true,
    });
  }

  /** Host (or anyone, if the room allows it) brings the agent in; others leave a request. */
  bringInAgent(roomId: string, actorUserId: string) {
    return this.call<AgentBringInResult>("POST", `/rooms/${enc(roomId)}/agent/bring-in`, {
      body: { actorUserId },
      auth: true,
    });
  }

  sendOutAgent(roomId: string, actorUserId: string) {
    return this.call<{ status: "off"; agent: "on" | "off" | "ask" }>(
      "POST",
      `/rooms/${enc(roomId)}/agent/send-out`,
      { body: { actorUserId }, auth: true },
    );
  }

  answerAgentRequest(roomId: string, requestId: string, actorUserId: string, approve: boolean) {
    return this.call<AgentBringInResult | { status: "declined"; agent: string }>(
      "POST",
      `/rooms/${enc(roomId)}/agent/requests/${enc(requestId)}/${approve ? "approve" : "decline"}`,
      { body: { actorUserId }, auth: true },
    );
  }

  /** Host: "anyone can add the agent" and the idle timeout (`null` goes back to the default). */
  updateAgentSettings(
    roomId: string,
    actorUserId: string,
    settings: { anyoneCanAddAgent?: boolean; idleTimeoutSeconds?: number | null },
  ) {
    return this.call<unknown>("PUT", `/rooms/${enc(roomId)}/agent`, {
      body: { actorUserId, ...settings },
      auth: true,
    });
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

  // ---- Onboarding and settings. `userId` for a product's user; omit it for the standalone
  // app's own signed-in user (the `/me` endpoints, with a Firebase ID token in `headers`). ----

  getOnboarding(userId?: string) {
    return this.call<OnboardingInfo>("GET", `${userPath(userId)}/onboarding`, { auth: true });
  }

  /** Ask the vendor whether a key works. The key is not stored. */
  checkKey(provider: KeyProviderName, key: string, userId?: string) {
    return this.call<KeyCheckResult>("POST", `${userPath(userId)}/keys/${enc(provider)}/check`, {
      body: { key },
      auth: true,
    });
  }

  saveKey(
    provider: KeyProviderName,
    key: string,
    opts: { tier: "free" | "paid"; noTrainingConfirmed?: boolean },
    userId?: string,
  ) {
    return this.call<{ provider: string; tier: string }>(
      "PUT",
      `${userPath(userId)}/keys/${enc(provider)}`,
      { body: { key, ...opts }, auth: true },
    );
  }

  startTrial(userId?: string) {
    return this.call<{ started: true; status: TrialInfo }>(
      "POST",
      `${userPath(userId)}/trial/start`,
      { body: {}, auth: true },
    );
  }

  getSettings(userId?: string) {
    return this.call<ModelSettings>("GET", `${userPath(userId)}/settings`, { auth: true });
  }

  /** Change your model or language setting. `llm: null` goes back to the default. */
  updateSettings(
    settings: {
      llm?: "gemini" | "openai" | "claude" | { provider: string; model?: string } | null;
      language?: "en" | "pt" | "auto";
    },
    userId?: string,
  ) {
    return this.call<ModelSettings>("PUT", `${userPath(userId)}/settings`, {
      body: { settings },
      auth: true,
    });
  }

  /** Room settings: the model, language and agent name for one room (host only to change). */
  getRoomSettings(roomId: string, viewerUserId: string) {
    return this.call<ModelSettings>("GET", `/rooms/${enc(roomId)}/settings`, {
      query: { viewerUserId },
      auth: true,
    });
  }

  updateRoomSettings(
    roomId: string,
    actorUserId: string,
    settings: {
      llm?: "gemini" | "openai" | "claude" | { provider: string; model?: string } | null;
      language?: "en" | "pt" | "auto";
      agentName?: string;
    },
  ) {
    return this.call<ModelSettings>("PUT", `/rooms/${enc(roomId)}/settings`, {
      body: { actorUserId, settings },
      auth: true,
    });
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
const userPath = (userId?: string) => (userId ? `/users/${enc(userId)}` : "/me");
