# OpenBlah server API

OpenAPI-style description of the server endpoints. Base path `/v1`. All endpoints need `Authorization: Bearer <API key>` (from `OPENBLAH_API_KEYS`) except `GET /health` and the two public guest endpoints marked **public**.

The API key belongs to the host app's backend, which vouches for its users. Host-control endpoints take the acting user as `actorUserId` (JSON body, or query string for `DELETE`/`GET`); the server checks that user's role in the room. Roles: `host`, `member` (app user), `guest` (joined by invite link).

Errors are `{ "error": "..." }` with 400 (bad input), 401 (no/wrong key), 403 (role not allowed), 404, 409 (state conflict), 429, 501.

## Rooms and tokens (T2)

| Method and path  | Body                                                                                                                                                      | Result                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /rooms`    | `hostUserId`, `hostDisplayName`, `agent` (`on\|off\|ask`, default `ask`), `agentName` (default `Blah`, or `OPENBLAH_AGENT_NAME`), `sensitive`, `metadata` | 201 room                                                                                                                                       |
| `GET /rooms/:id` |                                                                                                                                                           | room                                                                                                                                           |
| `POST /tokens`   | `roomId`, `userId`, `displayName`, optional `contact`                                                                                                     | `{ token, roomId, expiresIn }`. Registers the user as `host` or `member`. 409 if the room ended; 403 if the user was removed or is a guest id. |

The LiveKit token carries `{"role": ...}` as participant metadata. No role may change its own metadata; only the host gets `roomAdmin`; nobody gets recording rights.

## Invites

### `POST /rooms/:id/invites` (host)

Body: `actorUserId`, optional `expiresInSeconds` (60 to 30 days, default 86400), optional `maxUses` (1 to 100, default 1 = single use).
201: `{ id, roomId, token, url, expiresAt, maxUses }`. `url` is `<base>/<token>`, base `https://openblah.web.app/j` or `OPENBLAH_INVITE_BASE_URL`. The raw token is returned only here; only its SHA-256 hash is stored.

### `DELETE /rooms/:id/invites/:inviteId?actorUserId=` (host)

Revokes the invite. 200 `{ id, revoked: true }`.

### `GET /invites/:token` (public)

For the guest page. 200 `{ hostDisplayName, agent, agentName, consent: { version, text } }`. Unknown, expired, revoked, used-up and ended-room invites all give the same 404 `invite is not valid`.

### `POST /invites/:token/join` (public, CORS open)

Body: `displayName`, `consent: { accepted: true, textVersion }`. Consent is required unless the room's agent is `off`; `textVersion` must be the current version. Uses one invite slot only after all checks pass.
200: `{ token, roomId, userId, role: "guest", expiresIn, livekitUrl? }`. `userId` is generated (`guest_...`).
Rate limited per client IP and per token (default 10 and 20 requests per minute per instance); 429 with `Retry-After`.

## Consent

The consent text lives in `packages/server/src/consent.ts`, versioned by `CONSENT_VERSION`. It names the agent and has a processors list (placeholder until T19). Consent given for an older version does not count.

### `GET /rooms/:id/consent?userId=`

Any participant. `{ version, text, agentName, missing: [{ userId, displayName }] }`.

### `POST /rooms/:id/consent`

Body: `userId` (a participant), `accepted: true`, `textVersion`. Records `{ roomId, userId, textVersion, consentedAt }`.

### `POST /rooms/:id/agent/dispatch` (host)

Sends the agent into the room. 409 if the room's agent is `off`, or if any current (not removed) participant has not consented to the current version (`missing` lists them). The host can resolve a stalemate by setting the agent to `off`. 200 `{ dispatched: true }`.

## Host controls

| Method and path                             | Who  | Notes                                                                                                                       |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| `PUT /rooms/:id/agent`                      | host | Body `actorUserId`, `agent`. Updates the room and LiveKit room metadata.                                                    |
| `DELETE /rooms/:id/participants/:userId`    | host | Removes from LiveKit and bars new tokens. The host cannot be removed.                                                       |
| `POST /rooms/:id/end`                       | host | Deletes the LiveKit room; later tokens and invites are refused. Idempotent.                                                 |
| `POST /rooms/:id/approvals/:approvalId`     | host | Stub: always 501 until T13 adds write-action confirmation.                                                                  |
| `GET /rooms/:id/participants?viewerUserId=` | any  | Guests do not see `contact`; hosts and members do. Removed users are not listed.                                            |
| `GET /rooms/:id/permissions?userId=`        | any  | `{ role, canInvokeTools, canChangeAgentMode, canSeeContacts, isHost }`. The agent uses it to refuse tool calls from guests. |

## Usage and limits (T20)

| Method and path                         | Who  | Notes                                                                                                                                                                                 |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /rooms/:id/usage?actorUserId=`     | host | Read-only usage log: participant minutes, STT seconds per track, TTS characters, LLM tokens, estimated GBP cost per provider, effective limits, monthly minutes. See `docs/costs.md`. |
| `POST /rooms` with `maxDurationSeconds` | any  | Optional, and `idleTimeoutSeconds`: integers 1 to 86400 that lower the server defaults for this room.                                                                                 |
| `POST /rooms/:id/agent`                 | any  | 429 with `code` `host_cap` or `user_cap` when a monthly minute cap is reached.                                                                                                        |

## Guest rights

Guests cannot invoke tools on host accounts (`canInvokeTools: false`), cannot change agent mode or use any host control (403), and cannot see other participants' contact details. Token grants give guests no admin rights and no metadata updates.
