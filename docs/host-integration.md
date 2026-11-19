# Host integration guide

For products that embed OpenBlah (Housekeeper, TeraPay, your own app). Server endpoints are in [api.md](api.md); this page is the order to do things in and the decisions to make.

## The three steps

1. **Your backend** calls `POST /v1/rooms` and `POST /v1/tokens` with your OpenBlah API key (`Authorization: Bearer …`). It vouches for the user: the server trusts the `userId` you send.
2. **Your client** mounts `<OpenBlahRoom serverUrl token />` from `@openblah/web/react` or `@openblah/react-native` with the token ([quickstart.md](quickstart.md)).
3. **You register tools**: MCP servers or webhook tools in the `mcp` object of `POST /v1/rooms`.

Never ship the API key in a client. Point the client's `api.baseUrl` at a proxy on your backend that adds it.

## Embedding with MCP tools

Pass your product's MCP server in the room's `mcp` object. It stays server-side and is never returned to clients.

```json
{
  "hostUserId": "user-1",
  "hostDisplayName": "Maria",
  "agent": "on",
  "mcp": {
    "servers": [{ "id": "housekeeper", "url": "https://housekeeper.example/mcp" }],
    "userToken": "<the logged-in user's token for your MCP server>",
    "allowTools": ["list_tasks", "add_task"]
  }
}
```

- `userToken` is the logged-in user's token. Your own MCP server trusts it, so there is no OAuth screen. Voice never carries credentials.
- Users can also connect their own MCP servers with OAuth: [mcp-oauth.md](mcp-oauth.md) (`connectMcpInBrowser`, `connectMcpInApp`).
- `allowTools` keeps prompts short for big servers. Without it, all read-only tools are available.
- Tools that change things (book, send, pay) need the owner's confirmation. The component shows them as cards (`useToolApprovals`); the owner can also say yes out loud. Only the owner of the credentials can confirm. Details in [tools.md](tools.md).
- No MCP server? Use webhook tools (signed callbacks), also in [tools.md](tools.md).

## Product key or bring your own key

Who pays for the language and speech providers, in this order ([keys-and-trial.md](keys-and-trial.md)):

1. **BYOK**: the host user saves their own keys; their key pays in a group room.
2. **Product key** (embedded): you set provider keys for your API key (`OPENBLAH_PRODUCT_KEYS`). Your users never see keys. You pay, so plan per-user minute caps ([api.md](api.md), usage and limits).
3. **Trial**: OpenBlah's hosted key, for signed-in accounts only, a few minutes.

Self-hosting is the product-key mode with your own server.

A worked example for a first embedded product: [integrations/housekeeper.md](integrations/housekeeper.md).

## Warm-up

The agent worker scales to zero. Call `warmup` when the page or app opens, and when it becomes visible again, so the agent joins fast:

```ts
import { startWarmup } from "@openblah/web";
const stop = startWarmup({ serverUrl, apiKey, userId }); // returns a cleanup function
```

From a client, route this through your backend too (it needs the API key). It is cheap, safe to repeat and never throws; it is rate limited per user.

## Sensitive rooms

Create the room with `sensitive: true` for personal, patient or billing data. The server then refuses free-tier keys and the trial (`403 sensitive_free_tier`). Keys must be marked `paid` with `noTrainingConfirmed` by their owner. Free-tier Gemini may train on data, so do not use it for private data. `GET /v1/rooms/:id/key-mode` shows the mode and data terms. Consent for the agent is always asked of everyone in the room, including guests.

## Per-user tokens

- One token per user and room, from `POST /v1/tokens`. The token carries the role (`host` or `member`); guests join with an invite link instead and never get an API-key path.
- A removed user can no longer get tokens. When the host ends the room, tokens and invites stop.
- Do not share a token between users: the participant identity is the `userId`.
- Per-user MCP credentials: pass them as `mcp.userToken` for that room, or let the user connect with OAuth. A tool call runs with the credentials of its owner only.
