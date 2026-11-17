# MCP OAuth connect (T15)

Lets a person connect their own MCP servers (for example a calendar or a Housekeeper
server) with a normal OAuth sign-in. The agent then calls tools with **that person's**
token. Voice never carries credentials: the person signs in on the server's own page.

## How it works

Follows the MCP authorization spec (checked against the 2025-03-26 and later revisions):
OAuth 2.1 with PKCE (S256 only), protected-resource metadata (RFC 9728), authorization-server
metadata (RFC 8414), dynamic client registration (RFC 7591) and the `resource` parameter
(RFC 8707).

1. `POST …/mcp/connections { url, name?, scope?, returnUrl? }` probes the MCP server (it must
   answer 401), finds its authorization server, registers OpenBlah as a client (or uses a
   pre-registered one) and returns `{ id, authorizationUrl }`. The connection is `pending`.
2. The SDK opens `authorizationUrl` (popup on the web, in-app sheet or browser on mobile).
3. The server redirects to `GET /v1/mcp/callback?code&state`, hosted by this server. The
   one-time `state` is checked against its stored hash, the code is exchanged with the PKCE
   verifier, and the tokens are stored **encrypted** (same `KeyCipher` and
   `KEY_ENCRYPTION_SECRET` as BYOK keys, bound to the connection and owner). The connection is
   `connected`. A refused or expired sign-in becomes `error` with a short reason.
4. The SDK polls `GET …/mcp/connections/:id` and reports connected, refused, cancelled or timed out.

Scopes are minimal: only what the caller passes in `scope`, else the server's own hint.
Reconnecting the same server replaces (and revokes) the older connection.

## Endpoints

Per person, so they exist twice: `/v1/users/:userId/mcp/…` (product API key, the product vouches
for `userId`) and `/v1/me/mcp/…` (standalone app, Firebase ID token). The brief's
`POST /v1/mcp/connections` is `POST /v1/users/:userId/mcp/connections` or `/v1/me/mcp/connections`.

| Method and path                      | Result                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST …/mcp/connections`             | 201 `{ id, authorizationUrl }`                                                                                                                                                              |
| `GET …/mcp/connections`              | `{ connections: [{ id, serverUrl, name, status, scope, … }] }`                                                                                                                              |
| `GET …/mcp/connections/:id`          | one connection (poll this); 404 if it is not yours                                                                                                                                          |
| `POST …/mcp/connections/:id/test`    | `{ ok, message }`: refreshes the token if needed, then sends an MCP `initialize`                                                                                                            |
| `DELETE …/mcp/connections/:id`       | 204. Revokes at the server when it offers revocation, then deletes the tokens                                                                                                               |
| `GET /v1/mcp/callback`               | The consent redirect (no API key). Shows a result page, or redirects to an allowed `returnUrl` with `status` and `id`                                                                       |
| `POST /internal/rooms/:id/mcp-token` | Agent worker only (`OPENBLAH_AGENT_SECRET`): `{ ownerId, connectionId, refresh? }` → `{ accessToken }`. Only for the host or a non-guest member of that room, and only their own connection |

Tokens are never in any client response, room, dispatch metadata or log.

## In a room

When the agent is dispatched, each room member's `connected` servers are merged into the room's
server list next to the host-defined ones, as `{ id, url, ownerId, connectionId }` (no token). A
host-defined server for the same URL and owner wins. The host's `allowTools` list still applies to
the merged set, and a tool still runs only when its owner asked (T12). The worker fetches the token
from the server on every MCP request, so refreshed tokens are picked up, and refreshes once and
retries when the server answers 401. Refresh tokens rotate; refreshes are serialised per
connection inside one server instance.

## SDK

`@openblah/core` (`OpenBlahClient`): `connectMcpServer(url, { openAuthorization, userId?, scope?, … })`,
`listMcpServers`, `testMcpServer`, `disconnectMcpServer`. Rejects with `McpConnectError`
(`reason`: `refused`, `cancelled`, `timeout`); a cancelled or timed-out attempt is removed.

- `@openblah/web`: `connectMcpInBrowser(client, url)`. Call it straight from a click (the popup opens first so it is not blocked).
- `@openblah/react-native`: `connectMcpInApp(client, url, { openAuthSession? })`. Pass
  `(u) => WebBrowser.openAuthSessionAsync(u)` from `expo-web-browser` for an in-app sheet; the default
  opens the system browser.

## Configuration

| Variable                     | Meaning                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `OPENBLAH_PUBLIC_URL`        | Public base URL of this server. Enables the feature (also needs `KEY_ENCRYPTION_SECRET`). The callback is `<url>/v1/mcp/callback`. |
| `OPENBLAH_MCP_RETURN_URLS`   | Comma-separated allowed prefixes for `returnUrl` (app deep links). Default none.                                                   |
| `OPENBLAH_MCP_OAUTH_CLIENTS` | JSON `{"https://mcp.example.com":{"clientId":"…","clientSecret":"…"}}` for servers without dynamic registration.                   |
| `OPENBLAH_MCP_ALLOW_LOCAL`   | `true` allows http and local hosts (local tries only). Otherwise MCP URLs must be public https.                                    |

Without them the endpoints answer 501. The server fetches the URLs people give it, so by default it
refuses non-https and loopback or private hosts (a best-effort check by host name; add network-level
egress limits in production).

## Test server and end-to-end test

`tools/test-mcp-oauth/` is a small in-memory MCP server with OAuth (PKCE, dynamic registration,
rotating refresh tokens, revocation). `tools/test-mcp-oauth/e2e.test.ts` connects to it through the
real server routes, calls a tool with the real MCP client, expires the token and checks the refresh,
then disconnects and checks the tokens are gone. Run `pnpm test`.

## Try a real server

1. Pick a server you control that supports MCP OAuth, ideally with dynamic registration (a public
   one that does is fine too). If it does not support registration, register an OAuth client with
   redirect URI `<OPENBLAH_PUBLIC_URL>/v1/mcp/callback` and set `OPENBLAH_MCP_OAUTH_CLIENTS`.
2. Set `OPENBLAH_PUBLIC_URL` (and `KEY_ENCRYPTION_SECRET`) on the server.
3. Call `connectMcpInBrowser(client, "<server MCP url>")` or `POST /v1/me/mcp/connections`, consent,
   then `POST …/test`.

## Known limits

- Token storage is the main risk (plan section 11): tokens are encrypted at rest, but whoever holds
  `KEY_ENCRYPTION_SECRET` and the database can read them. Keep the secret in Secret Manager.
- Refresh serialisation is per instance; with several server instances two refreshes could race and
  one would then show "sign in again".
- `test` only sends `initialize`; it does not list tools.
