import { createHash, randomBytes } from "node:crypto";
import { KeyCipher, type Sealed } from "./crypto.js";
import type { Storage } from "./types.js";

/**
 * Per-user OAuth for MCP servers (MCP authorization spec: OAuth 2.1 with PKCE
 * S256, protected-resource metadata RFC 9728, authorization-server metadata
 * RFC 8414, dynamic client registration RFC 7591, resource indicators RFC 8707).
 * Tokens are sealed with the same cipher as BYOK keys and only ever leave this
 * service towards the agent worker (`/internal`), never to a client or the voice path.
 */

export type McpConnectionStatus = "pending" | "connected" | "error";

/** A stored connection. Everything secret is inside `sealed` fields. */
export interface McpConnectionRecord extends Sealed {
  id: string;
  ownerId: string;
  serverUrl: string;
  name: string;
  status: McpConnectionStatus;
  /** Short reason when `status` is "error". Never a token. */
  error?: string;
  scope?: string;
  clientId: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  resource: string;
  redirectUri: string;
  /** Hash of the one-time `state` while a sign-in is pending. */
  stateHash?: string;
  pendingExpiresAt?: string;
  /** Where to send the browser after the consent (must match the allow-list). */
  returnUrl?: string;
  createdAt: string;
  connectedAt?: string;
}

/** What may be shown about a connection. */
export interface McpConnectionInfo {
  id: string;
  serverUrl: string;
  name: string;
  status: McpConnectionStatus;
  error?: string;
  scope?: string;
  createdAt: string;
  connectedAt?: string;
}

/** The secrets, sealed as one JSON blob. */
interface Secrets {
  codeVerifier?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt?: number;
  clientSecret?: string;
}

export class McpOAuthError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 502,
    message: string,
  ) {
    super(message);
    this.name = "McpOAuthError";
  }
}

export interface McpOAuthOptions {
  /** Public URL of this server's callback, e.g. `https://api.example.com/v1/mcp/callback`. */
  callbackUrl: string;
  /** Allowed prefixes for `returnUrl` (app deep links, web pages). Default: none. */
  returnUrlPrefixes?: string[];
  /** Pre-registered OAuth clients by server origin, for servers without dynamic registration. */
  preregistered?: Record<string, { clientId: string; clientSecret?: string }>;
  /** Allow http and loopback/private hosts (tests, local tries). Default false. */
  allowLocal?: boolean;
  fetch?: typeof fetch;
  now?: () => Date;
  /** How long a started sign-in stays valid. Default 10 minutes. */
  pendingTtlMs?: number;
}

const REFRESH_SKEW_MS = 60_000;
const sha256Hex = (v: string) => createHash("sha256").update(v).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");

/** Parse `{"https://mcp.example.com":{"clientId":"..","clientSecret":".."}}`. */
export function parsePreregistered(raw: string | undefined): McpOAuthOptions["preregistered"] {
  if (!raw) return undefined;
  return JSON.parse(raw) as NonNullable<McpOAuthOptions["preregistered"]>;
}

function isLocalHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    /^(127|10|0)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^f[cd][0-9a-f]{2}:/.test(h)
  );
}

export class McpOAuthService {
  private readonly doFetch: typeof fetch;
  private readonly now: () => Date;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly storage: Storage,
    private readonly cipher: KeyCipher,
    private readonly o: McpOAuthOptions,
  ) {
    this.doFetch = o.fetch ?? ((...a) => fetch(...a));
    this.now = o.now ?? (() => new Date());
  }

  // ---- Secrets ----

  private aad = (id: string, ownerId: string) => `mcp|${id}|${ownerId}`;
  private seal(id: string, ownerId: string, s: Secrets): Sealed {
    return this.cipher.seal(JSON.stringify(s), this.aad(id, ownerId));
  }
  private open(rec: McpConnectionRecord): Secrets {
    return JSON.parse(this.cipher.open(rec, this.aad(rec.id, rec.ownerId))) as Secrets;
  }

  private info(r: McpConnectionRecord): McpConnectionInfo {
    const pendingExpired =
      r.status === "pending" &&
      r.pendingExpiresAt !== undefined &&
      Date.parse(r.pendingExpiresAt) <= this.now().getTime();
    return {
      id: r.id,
      serverUrl: r.serverUrl,
      name: r.name,
      status: pendingExpired ? "error" : r.status,
      ...(pendingExpired ? { error: "Sign-in timed out" } : r.error ? { error: r.error } : {}),
      ...(r.scope ? { scope: r.scope } : {}),
      createdAt: r.createdAt,
      ...(r.connectedAt ? { connectedAt: r.connectedAt } : {}),
    };
  }

  // ---- Network helpers ----

  private checkUrl(raw: string, what: string): URL {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      throw new McpOAuthError(400, `${what} is not a valid URL`);
    }
    if (!this.o.allowLocal) {
      if (u.protocol !== "https:") throw new McpOAuthError(400, `${what} must use https`);
      if (isLocalHost(u.hostname)) throw new McpOAuthError(400, `${what} must be a public host`);
    } else if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new McpOAuthError(400, `${what} must use http or https`);
    }
    if (u.username || u.password) throw new McpOAuthError(400, `${what} must not hold credentials`);
    return u;
  }

  private async getJson(url: string): Promise<Record<string, unknown> | null> {
    try {
      const res = await this.doFetch(url, {
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const data: unknown = await res.json();
      return typeof data === "object" && data && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  private async postForm(url: string, form: Record<string, string>): Promise<Response> {
    return this.doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(form),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  }

  /** Find the protected-resource metadata and the scope hint the server gives. */
  private async discoverResource(
    server: URL,
  ): Promise<{ meta: Record<string, unknown> | null; scopeHint?: string }> {
    let metaUrl: string | undefined;
    let scopeHint: string | undefined;
    try {
      const res = await this.doFetch(server, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "openblah-server", version: "0.0.0" },
          },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status !== 401) {
        throw new McpOAuthError(
          400,
          res.ok
            ? "This server does not ask for a sign-in"
            : `The server answered ${res.status} instead of asking for a sign-in`,
        );
      }
      const header = res.headers.get("www-authenticate") ?? "";
      metaUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1];
      scopeHint = /scope="([^"]+)"/.exec(header)?.[1];
      await res.body?.cancel().catch(() => undefined);
    } catch (e) {
      if (e instanceof McpOAuthError) throw e;
      throw new McpOAuthError(502, "Could not reach the MCP server");
    }
    const candidates = [
      ...(metaUrl ? [metaUrl] : []),
      `${server.origin}/.well-known/oauth-protected-resource${server.pathname === "/" ? "" : server.pathname}`,
      `${server.origin}/.well-known/oauth-protected-resource`,
    ];
    for (const c of candidates) {
      this.checkUrl(c, "Resource metadata URL");
      const meta = await this.getJson(c);
      if (meta) return { meta, scopeHint };
    }
    return { meta: null, scopeHint };
  }

  private async discoverAuthServer(issuer: URL): Promise<Record<string, unknown>> {
    const path = issuer.pathname === "/" ? "" : issuer.pathname.replace(/\/$/, "");
    const candidates = [
      `${issuer.origin}/.well-known/oauth-authorization-server${path}`,
      `${issuer.origin}/.well-known/openid-configuration${path}`,
      `${issuer.origin}${path}/.well-known/openid-configuration`,
    ];
    for (const c of candidates) {
      const meta = await this.getJson(c);
      if (meta && typeof meta.authorization_endpoint === "string") return meta;
    }
    throw new McpOAuthError(502, "Could not find the server's sign-in settings");
  }

  // ---- Start ----

  /** Begin a connection. Returns the URL the user must open to consent. */
  async start(
    ownerId: string,
    input: { url: string; name?: string; scope?: string; returnUrl?: string },
  ): Promise<{ id: string; authorizationUrl: string }> {
    const server = this.checkUrl(input.url, "Server URL");
    server.hash = "";
    if (input.returnUrl !== undefined) {
      const ok = (this.o.returnUrlPrefixes ?? []).some((p) => input.returnUrl?.startsWith(p));
      if (!ok) throw new McpOAuthError(400, "returnUrl is not allowed");
    }
    const { meta, scopeHint } = await this.discoverResource(server);
    const issuerRaw =
      (Array.isArray(meta?.authorization_servers) &&
      typeof meta.authorization_servers[0] === "string"
        ? meta.authorization_servers[0]
        : undefined) ?? server.origin;
    const asMeta = await this.discoverAuthServer(this.checkUrl(issuerRaw, "Authorization server"));
    const methods = asMeta.code_challenge_methods_supported;
    if (Array.isArray(methods) && !methods.includes("S256")) {
      throw new McpOAuthError(400, "The server does not support PKCE (S256)");
    }
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const authEndpoint = this.checkUrl(
      str(asMeta.authorization_endpoint) ?? "",
      "Authorization endpoint",
    );
    const tokenEndpoint = str(asMeta.token_endpoint);
    if (!tokenEndpoint) throw new McpOAuthError(502, "The server has no token endpoint");
    this.checkUrl(tokenEndpoint, "Token endpoint");
    const revocation = str(asMeta.revocation_endpoint);
    if (revocation) this.checkUrl(revocation, "Revocation endpoint");

    // Client: pre-registered, or register dynamically.
    let clientId: string;
    let clientSecret: string | undefined;
    const pre = this.o.preregistered?.[server.origin];
    if (pre) {
      clientId = pre.clientId;
      clientSecret = pre.clientSecret;
    } else {
      const reg = str(asMeta.registration_endpoint);
      if (!reg) {
        throw new McpOAuthError(
          400,
          "This server needs a pre-registered OAuth client; ask the owner to add it",
        );
      }
      this.checkUrl(reg, "Registration endpoint");
      let res: Response;
      try {
        res = await this.doFetch(reg, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            client_name: "OpenBlah",
            redirect_uris: [this.o.callbackUrl],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new McpOAuthError(502, "Could not register with the server");
      }
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || typeof data?.client_id !== "string") {
        throw new McpOAuthError(502, "The server refused to register OpenBlah");
      }
      clientId = data.client_id;
      clientSecret = str(data.client_secret);
    }

    const id = `mc_${randomBytes(8).toString("hex")}`;
    const state = `${id}.${b64url(randomBytes(24))}`;
    const verifier = b64url(randomBytes(48));
    const resource = str(meta?.resource) ?? server.toString();
    // Minimal scopes: only what the caller asked for, else the server's own hint.
    const scope = input.scope?.trim() || scopeHint;
    const url = new URL(authEndpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", this.o.callbackUrl);
    url.searchParams.set("code_challenge", b64url(createHash("sha256").update(verifier).digest()));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("resource", resource);
    if (scope) url.searchParams.set("scope", scope);

    const now = this.now();
    const record: McpConnectionRecord = {
      id,
      ownerId,
      serverUrl: server.toString(),
      name: input.name?.trim().slice(0, 100) || server.hostname,
      status: "pending",
      ...(scope ? { scope } : {}),
      clientId,
      tokenEndpoint,
      ...(revocation ? { revocationEndpoint: revocation } : {}),
      resource,
      redirectUri: this.o.callbackUrl,
      stateHash: sha256Hex(state),
      pendingExpiresAt: new Date(now.getTime() + (this.o.pendingTtlMs ?? 600_000)).toISOString(),
      ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
      createdAt: now.toISOString(),
      ...this.seal(id, ownerId, { codeVerifier: verifier, clientSecret }),
    };
    await this.storage.putMcpConnection(record);
    return { id, authorizationUrl: url.toString() };
  }

  // ---- Callback ----

  /** Finish the sign-in. Never throws; the result is for the page shown to the user. */
  async complete(params: {
    state?: string;
    code?: string;
    error?: string;
  }): Promise<{ ok: boolean; id?: string; message: string; returnUrl?: string }> {
    const state = params.state ?? "";
    const id = state.split(".")[0] ?? "";
    const rec = id ? await this.storage.getMcpConnection(id) : null;
    if (!rec || rec.status !== "pending" || !rec.stateHash || rec.stateHash !== sha256Hex(state)) {
      return { ok: false, message: "This sign-in link is not valid any more. Start again." };
    }
    const done = async (patch: Partial<McpConnectionRecord>, secrets?: Secrets) => {
      const next: McpConnectionRecord = {
        ...rec,
        ...patch,
        ...(secrets ? this.seal(rec.id, rec.ownerId, secrets) : {}),
      };
      delete next.stateHash;
      delete next.pendingExpiresAt;
      await this.storage.putMcpConnection(next);
    };
    const back = (ok: boolean) =>
      rec.returnUrl
        ? {
            returnUrl: withParams(rec.returnUrl, {
              status: ok ? "connected" : "error",
              id: rec.id,
            }),
          }
        : {};
    const fail = async (message: string) => {
      await done({ status: "error", error: message }, {});
      return { ok: false, id: rec.id, message, ...back(false) };
    };
    if (Date.parse(rec.pendingExpiresAt ?? "") <= this.now().getTime()) {
      return fail("Sign-in timed out. Start again.");
    }
    if (params.error) return fail("Sign-in was cancelled or refused.");
    if (!params.code) return fail("The server sent no authorization code.");
    const secrets = this.open(rec);
    let tokens: TokenSet;
    try {
      tokens = await this.tokenRequest(rec, secrets.clientSecret, {
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: rec.redirectUri,
        code_verifier: secrets.codeVerifier ?? "",
        resource: rec.resource,
      });
    } catch {
      return fail("The server did not accept the sign-in.");
    }
    const at = this.now();
    await done(
      {
        status: "connected",
        connectedAt: at.toISOString(),
        ...(tokens.scope ? { scope: tokens.scope } : {}),
        error: undefined,
      },
      toSecrets(tokens, at, secrets.clientSecret),
    );
    // Reconnecting the same server replaces the older connection (and revokes it).
    for (const old of await this.storage.listMcpConnections(rec.ownerId)) {
      if (old.id !== rec.id && old.serverUrl === rec.serverUrl) await this.remove(old);
    }
    return {
      ok: true,
      id: rec.id,
      message: "Connected. You can close this window.",
      ...back(true),
    };
  }

  private async tokenRequest(
    rec: McpConnectionRecord,
    clientSecret: string | undefined,
    form: Record<string, string>,
  ): Promise<TokenSet> {
    const res = await this.postForm(rec.tokenEndpoint, {
      ...form,
      client_id: rec.clientId,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok || typeof data?.access_token !== "string") {
      throw Object.assign(new Error("token request refused"), {
        oauthError: typeof data?.error === "string" ? data.error : undefined,
      });
    }
    return {
      accessToken: data.access_token,
      ...(typeof data.refresh_token === "string" ? { refreshToken: data.refresh_token } : {}),
      ...(typeof data.expires_in === "number" ? { expiresIn: data.expires_in } : {}),
      ...(typeof data.scope === "string" ? { scope: data.scope } : {}),
    };
  }

  // ---- Use ----

  async list(ownerId: string): Promise<McpConnectionInfo[]> {
    const all = await this.storage.listMcpConnections(ownerId);
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => this.info(r));
  }

  private async load(ownerId: string, id: string): Promise<McpConnectionRecord> {
    const rec = await this.storage.getMcpConnection(id);
    // Same answer for "missing" and "someone else's".
    if (!rec || rec.ownerId !== ownerId) throw new McpOAuthError(404, "no such connection");
    return rec;
  }

  async get(ownerId: string, id: string): Promise<McpConnectionInfo> {
    return this.info(await this.load(ownerId, id));
  }

  /** A fresh access token, refreshing it when it is about to expire. Server-side use only. */
  async accessToken(
    ownerId: string,
    id: string,
    opts: { forceRefresh?: boolean } = {},
  ): Promise<{ accessToken: string; expiresAt?: number }> {
    // One refresh at a time per connection: refresh tokens rotate.
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(() => this.accessTokenLocked(ownerId, id, opts.forceRefresh === true));
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  private async accessTokenLocked(ownerId: string, id: string, force: boolean) {
    const rec = await this.load(ownerId, id);
    if (rec.status !== "connected") throw new McpOAuthError(409, "connection is not signed in");
    const secrets = this.open(rec);
    const expiring =
      secrets.expiresAt !== undefined &&
      secrets.expiresAt - REFRESH_SKEW_MS <= this.now().getTime();
    if (secrets.accessToken && !expiring && !force) {
      return { accessToken: secrets.accessToken, expiresAt: secrets.expiresAt };
    }
    if (!secrets.refreshToken) {
      await this.markError(rec, "Signed out: sign in again");
      throw new McpOAuthError(409, "access token expired and there is no refresh token");
    }
    let tokens: TokenSet;
    try {
      tokens = await this.tokenRequest(rec, secrets.clientSecret, {
        grant_type: "refresh_token",
        refresh_token: secrets.refreshToken,
        resource: rec.resource,
      });
    } catch (e) {
      // Only a definite refusal means the user must sign in again.
      if ((e as { oauthError?: string }).oauthError === "invalid_grant") {
        await this.markError(rec, "Signed out: sign in again");
        throw new McpOAuthError(409, "refresh token was refused");
      }
      throw new McpOAuthError(502, "could not refresh the token");
    }
    const at = this.now();
    const next = toSecrets(
      { ...tokens, refreshToken: tokens.refreshToken ?? secrets.refreshToken },
      at,
      secrets.clientSecret,
    );
    await this.storage.putMcpConnection({ ...rec, ...this.seal(rec.id, rec.ownerId, next) });
    return { accessToken: next.accessToken as string, expiresAt: next.expiresAt };
  }

  private async markError(rec: McpConnectionRecord, message: string): Promise<void> {
    await this.storage.putMcpConnection({
      ...rec,
      status: "error",
      error: message,
      ...this.seal(rec.id, rec.ownerId, {}),
    });
  }

  /** Try the connection against the MCP server. */
  async test(ownerId: string, id: string): Promise<{ ok: boolean; message: string }> {
    const rec = await this.load(ownerId, id);
    let token: string;
    try {
      token = (await this.accessToken(ownerId, id)).accessToken;
    } catch (e) {
      return { ok: false, message: e instanceof McpOAuthError ? e.message : "no token" };
    }
    try {
      const res = await this.doFetch(rec.serverUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "openblah-server", version: "0.0.0" },
          },
        }),
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 401) return { ok: false, message: "The server rejected the sign-in" };
      return res.ok
        ? { ok: true, message: "Connected" }
        : { ok: false, message: `The server answered ${res.status}` };
    } catch {
      return { ok: false, message: "Could not reach the MCP server" };
    }
  }

  /** Disconnect: revoke at the server when it supports that, then delete the tokens. */
  async disconnect(ownerId: string, id: string): Promise<void> {
    await this.remove(await this.load(ownerId, id));
  }

  private async remove(rec: McpConnectionRecord): Promise<void> {
    if (rec.status === "connected" && rec.revocationEndpoint) {
      try {
        const s = this.open(rec);
        const token = s.refreshToken ?? s.accessToken;
        if (token) {
          const res = await this.postForm(rec.revocationEndpoint, {
            token,
            client_id: rec.clientId,
            ...(s.clientSecret ? { client_secret: s.clientSecret } : {}),
          });
          await res.body?.cancel().catch(() => undefined);
        }
      } catch {
        // Best effort: the tokens are deleted below either way.
      }
    }
    await this.storage.deleteMcpConnection(rec.id);
  }

  /** Connected servers of a user, for merging into a room. */
  async connected(ownerId: string): Promise<McpConnectionInfo[]> {
    return (await this.list(ownerId)).filter((c) => c.status === "connected");
  }
}

interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scope?: string;
}

function toSecrets(t: TokenSet, at: Date, clientSecret: string | undefined): Secrets {
  return {
    accessToken: t.accessToken,
    ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}),
    ...(t.expiresIn ? { expiresAt: at.getTime() + t.expiresIn * 1000 } : {}),
    ...(clientSecret ? { clientSecret } : {}),
  };
}

function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** A small result page for the callback. `message` is plain text and is escaped. */
export function callbackPage(ok: boolean, message: string): string {
  const esc = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ok ? "Connected" : "Not connected"}</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem"><h1>${ok ? "Connected" : "Not connected"}</h1><p>${esc}</p></body></html>`;
}
