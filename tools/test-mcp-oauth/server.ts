import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny MCP server protected by OAuth 2.1 (PKCE, dynamic client registration,
 * refresh tokens), for tests and manual tries. Not for production: it approves
 * every authorization request for one fixed user and keeps everything in memory.
 * It speaks just enough MCP (JSON responses over Streamable HTTP): initialize,
 * tools/list and tools/call with one read-only tool, `whoami`.
 */
export interface TestMcpOAuthOptions {
  /** Access token lifetime in seconds. Default 3600. */
  accessTtlSeconds?: number;
  /** Scopes the server offers. Default ["mcp:read"]. */
  scopes?: string[];
  port?: number;
}

export interface TestMcpOAuth {
  /** Base URL, e.g. http://127.0.0.1:4010 */
  url: string;
  /** The MCP endpoint URL (the one a user adds as a server). */
  mcpUrl: string;
  /** Make every issued access token expire now (to test refresh). */
  expireAccessTokens(): void;
  /** What happened, for assertions. */
  stats: {
    registrations: number;
    refreshes: number;
    revocations: number;
    toolCalls: number;
    /** Authorization header values that reached /mcp with a valid token. */
    lastScope: string | undefined;
    lastResourceParam: string | undefined;
  };
  /** Number of refresh tokens still valid. */
  liveRefreshTokens(): number;
  close(): Promise<void>;
}

interface Client {
  redirectUris: string[];
}
interface Code {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope: string;
  resource: string | undefined;
}
interface Access {
  clientId: string;
  scope: string;
  expiresAt: number;
}

const b64url = (b: Buffer) => b.toString("base64url");
const rand = (n = 24) => b64url(randomBytes(n));

async function readBody(req: IncomingMessage): Promise<string> {
  let s = "";
  for await (const chunk of req) s += chunk;
  return s;
}

export async function startTestMcpOAuth(opts: TestMcpOAuthOptions = {}): Promise<TestMcpOAuth> {
  const ttl = opts.accessTtlSeconds ?? 3600;
  const scopes = opts.scopes ?? ["mcp:read"];
  const clients = new Map<string, Client>();
  const codes = new Map<string, Code>();
  const access = new Map<string, Access>();
  const refresh = new Map<string, { clientId: string; scope: string }>();
  const stats: TestMcpOAuth["stats"] = {
    registrations: 0,
    refreshes: 0,
    revocations: 0,
    toolCalls: 0,
    lastScope: undefined,
    lastResourceParam: undefined,
  };
  let base = "";

  const send = (res: ServerResponse, status: number, body: unknown, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  const oauthError = (res: ServerResponse, error: string, status = 400) =>
    send(res, status, { error });

  const issue = (clientId: string, scope: string) => {
    const accessToken = `at_${rand()}`;
    const refreshToken = `rt_${rand()}`;
    access.set(accessToken, { clientId, scope, expiresAt: Date.now() + ttl * 1000 });
    refresh.set(refreshToken, { clientId, scope });
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: ttl,
      scope,
    };
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;

    if (
      path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/mcp"
    ) {
      return send(res, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: scopes,
        bearer_methods_supported: ["header"],
      });
    }
    if (path === "/.well-known/oauth-authorization-server") {
      return send(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        revocation_endpoint: `${base}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: scopes,
      });
    }
    if (path === "/register" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { redirect_uris?: string[] };
      if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
        return oauthError(res, "invalid_redirect_uri");
      }
      const clientId = `client_${rand(8)}`;
      clients.set(clientId, { redirectUris: body.redirect_uris });
      stats.registrations += 1;
      return send(res, 201, {
        client_id: clientId,
        redirect_uris: body.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    }
    if (path === "/authorize" && req.method === "GET") {
      const q = url.searchParams;
      const client = clients.get(q.get("client_id") ?? "");
      const redirectUri = q.get("redirect_uri") ?? "";
      // Never redirect to an unregistered URI.
      if (!client || !client.redirectUris.includes(redirectUri)) {
        return oauthError(res, "invalid_client");
      }
      const target = new URL(redirectUri);
      const state = q.get("state");
      if (state) target.searchParams.set("state", state);
      if (
        q.get("response_type") !== "code" ||
        q.get("code_challenge_method") !== "S256" ||
        !q.get("code_challenge")
      ) {
        target.searchParams.set("error", "invalid_request");
      } else {
        const code = `code_${rand()}`;
        codes.set(code, {
          clientId: q.get("client_id") as string,
          redirectUri,
          challenge: q.get("code_challenge") as string,
          scope: q.get("scope") ?? scopes.join(" "),
          resource: q.get("resource") ?? undefined,
        });
        target.searchParams.set("code", code);
      }
      res.writeHead(302, { location: target.toString() });
      return res.end();
    }
    if (path === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const grant = form.get("grant_type");
      if (grant === "authorization_code") {
        const code = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? ""); // one use
        if (!code) return oauthError(res, "invalid_grant");
        const verifier = form.get("code_verifier") ?? "";
        const challenge = b64url(createHash("sha256").update(verifier).digest());
        if (
          form.get("client_id") !== code.clientId ||
          form.get("redirect_uri") !== code.redirectUri ||
          challenge !== code.challenge
        ) {
          return oauthError(res, "invalid_grant");
        }
        stats.lastScope = code.scope;
        stats.lastResourceParam = code.resource;
        return send(res, 200, issue(code.clientId, code.scope));
      }
      if (grant === "refresh_token") {
        const token = form.get("refresh_token") ?? "";
        const rec = refresh.get(token);
        if (!rec || rec.clientId !== form.get("client_id")) return oauthError(res, "invalid_grant");
        refresh.delete(token); // rotate
        stats.refreshes += 1;
        return send(res, 200, issue(rec.clientId, rec.scope));
      }
      return oauthError(res, "unsupported_grant_type");
    }
    if (path === "/revoke" && req.method === "POST") {
      const form = new URLSearchParams(await readBody(req));
      const token = form.get("token") ?? "";
      if (refresh.delete(token) || access.delete(token)) stats.revocations += 1;
      return send(res, 200, {});
    }
    if (path === "/mcp" && req.method === "POST") {
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1] ?? "";
      const tok = access.get(bearer);
      if (!tok || tok.expiresAt <= Date.now()) {
        return send(
          res,
          401,
          { error: "unauthorized" },
          {
            "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
          },
        );
      }
      const msg = JSON.parse((await readBody(req)) || "{}") as {
        id?: number | string;
        method?: string;
        params?: { name?: string };
      };
      const reply = (result: unknown) => send(res, 200, { jsonrpc: "2.0", id: msg.id, result });
      if (msg.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      if (msg.method === "initialize") {
        return reply({
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "test-mcp-oauth", version: "0.0.0" },
        });
      }
      if (msg.method === "tools/list") {
        return reply({
          tools: [
            {
              name: "whoami",
              description: "Say who is signed in.",
              inputSchema: { type: "object", properties: {} },
              annotations: { readOnlyHint: true },
            },
          ],
        });
      }
      if (msg.method === "tools/call") {
        stats.toolCalls += 1;
        return reply({
          content: [{ type: "text", text: `signed in as test-user (${tok.scope})` }],
        });
      }
      return send(res, 200, {
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: "method not found" },
      });
    }
    send(res, 404, { error: "not found" });
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 500, { error: "server_error" });
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    url: base,
    mcpUrl: `${base}/mcp`,
    stats,
    expireAccessTokens() {
      for (const a of access.values()) a.expiresAt = 0;
    },
    liveRefreshTokens: () => refresh.size,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
