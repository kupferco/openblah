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

## Who pays: choose a mode

OpenBlah and its products are free and open source, so you decide who pays for the language and speech providers. Each product has a `whoPays` setting you can change at any time ([keys-and-trial.md](keys-and-trial.md)):

| Mode            | Who pays                                                                       | What users see                                                         |
| --------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `user_key`      | The user's own key. The product key is never used. **Default for new products.** | On first voice start: "Add your own key to keep using voice".          |
| `product_trial` | Your key, up to a per-user allowance (default 5 minutes, `trialSeconds`), then the user's own key. | Voice works at once, then the add-key prompt when the allowance is used. |
| `product`       | Your key pays for everyone (set `OPENBLAH_PRODUCT_KEYS`). Good for early testing. | Nothing. Each user is capped at 60 minutes a month by default; raise or turn it off with `userMonthlyMinutes`. |

How to switch:

- **Screen:** open `/owner` on the server, paste the product API key, pick the mode and save.
- **REST:** `PUT /v1/product/settings` with `{ "settings": { "whoPays": "user_key" } }` (product API key only).
- **Settings MCP tool:** `propose_settings_change` then `confirm_settings_change`, only with the product's key, never from an end user's voice session. See [model-settings.md](model-settings.md).

What happens on a switch:

- The change applies to the next voice start. Calls already running finish (up to the room's max duration). Text chat and the rest of your product are unaffected.
- A user who is not covered gets `402 key_required` (`reason`: `product_not_paying` or `trial_used`). The SDKs throw a typed `KeyRequiredError`; pass it to `<OpenBlahRoom keyRequired onAddKey />` and open `<OpenBlahAddKeySheet />` (Gemini first, then OpenAI and Claude). The sheet tells users that consumer subscriptions (ChatGPT Plus, Claude app, Gemini app) cannot power another app, so an API key is needed; a free Gemini key is the easy start. Free-tier keys are refused in `sensitive` rooms.
- To show the banner before the user taps, call `GET /v1/users/:userId/key-status` (`ok` or `needs_key`; `api.getKeyStatus`, `useKeyStatus`).
- Switching back to `product` is instant. Saved user keys stay stored and are simply not used; users can delete them. Keys are per product and user.
- The owner screen shows counts only (never names or keys): users with their own key, users asked for a key in the last 30 days, and minutes used on your key. Test users are left out.

LiveKit call minutes always land on the OpenBlah server's LiveKit account, in every mode, whoever pays for the LLM key. They are capped per product and globally (`402 livekit_cap`); see [costs.md](costs.md).

Self-hosting is the `product` mode with your own server.

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
