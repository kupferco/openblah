# Key modes, trial and accounts

Who pays for the speech and language providers (Gemini, Deepgram, Cartesia) in a room.
The server picks one mode per room, in this order:

1. **BYOK**: the host's own keys, saved with `saveKey`. The host's key pays in a group room.
   Needs all three providers.
2. **Product key**: the embedding product's keys, set per API key in `OPENBLAH_PRODUCT_KEYS`.
   **Self-hosted** is the same thing: set `OPENBLAH_SELF_HOSTED=true` with the provider keys
   in the environment (or a `"*"` entry).
3. **Trial**: OpenBlah's hosted keys (`OPENBLAH_TRIAL_*_API_KEY`), for signed-in accounts only.

If none applies, starting the agent answers an error (`409 no_key`, `401 sign_in_required`,
`402 trial_exhausted` or `402 key_required`). If no mode is configured at all, the worker keeps using its own
environment keys, as before.

## Who pays (per product)

A product has a setting `whoPays`, changed with `PUT /v1/product/settings`
(`{ "settings": { "whoPays": "user_key" } }`, product API key only; rooms, users and the
settings MCP tool cannot set it):

- `product`: the product's key pays for everyone; a user's own key is not used.
- `user_key`: only the host's own key; the product's key is never used.
- `product_trial`: the host's own key if saved, else the product's key while the per-user
  allowance lasts (the counter and allowance come in a later part of plan 370; until then the
  allowance counts as used).

When the mode refuses, starting voice answers `402 key_required` with `reason`
`product_not_paying` or `trial_used`. The change applies to the next voice start; calls
already running finish. Text chat is not affected.

A product with no setting keeps the order above (BYOK, product key, trial) unless the server
sets `OPENBLAH_DEFAULT_WHO_PAYS` (`user_key` for new products; self-hosted servers
(`OPENBLAH_SELF_HOSTED=true`) default to `product`).

## BYOK

- `PUT /v1/users/:userId/keys/:provider` with `{ key, tier: "free"|"paid", noTrainingConfirmed? }`
  (product API key, the product vouches for `userId`), or `PUT /v1/me/keys/:provider` for a
  standalone-app user (Firebase ID token). `GET /keys` lists metadata, `DELETE /keys/:provider`
  deletes.
- Stored with AES-256-GCM, bound to owner and provider, with a `keyVersion` for rotation.
  `KEY_ENCRYPTION_SECRET` is one secret or `v2:new,v1:old`: the first seals, all open. Put the
  secret in Secret Manager. To rotate, add the new one first, ask users to re-save (or reseal),
  then drop the old one.
- The key is never logged and never returned: not on save, list, room, key-mode or token
  responses. The only path to plaintext is `POST /internal/rooms/:id/provider-keys`, for the
  agent worker, authenticated with `OPENBLAH_AGENT_SECRET` (not an API key).
- Used only for rooms the owner hosts.
- MCP OAuth tokens (T15, [mcp-oauth.md](mcp-oauth.md)) are sealed with the same cipher and secret, so rotating `KEY_ENCRYPTION_SECRET` applies to them too (reconnect or re-seal before dropping the old secret).

## Trial

300 seconds of agent audio per account (seconds the agent listens, thinks or speaks, reported
by the worker every 10 s and counted on the server). Also a soft per-device limit (default 600 s
over all accounts on that device; the device ID comes from `X-OpenBlah-Device` or
`metadata.deviceId` on the room) and a global cap (default 200000 s). Limits are env settings.
Sign-in is required. The trial is free tier, so it is refused in sensitive rooms.

## Sensitive rooms

A room created with `sensitive: true` refuses free-tier keys and the trial (`403
sensitive_free_tier`, with the data terms in the message). BYOK keys must be marked `paid`
with `noTrainingConfirmed: true` by their owner. No DPA is enforced in code (Q5).
`GET /v1/rooms/:id/key-mode` returns the mode, tier and `dataTerms`, never keys.

## Accounts

The standalone app signs in with Firebase Auth (email link, Google) and sends the ID token to
`/v1/me/*`; the server verifies it against Google's keys for `FIREBASE_PROJECT_ID` and keeps a
minimal user record (`id`, `email`, `isTest`, `createdAt`). `isTest` is true for the preview
test user and must stay out of analytics and counts.

## SDK

`OpenBlahServerClient` (`@openblah/server`): `saveKey`, `deleteKey`, `listKeys`,
`getTrialStatus`. Use a product API key plus `userId` from a backend, or a Firebase ID token
from the app. A client must not embed the product API key.
