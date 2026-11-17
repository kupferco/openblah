# Model setting, onboarding and the settings tool (T17)

## Three levels

The agent's model is a setting at three levels. Highest precedence first:

1. **Room**: `PUT /v1/rooms/:id/settings` (host only).
2. **User / product**: a user's own choice (`PUT /v1/users/:userId/settings`, or `/v1/me/settings`
   in the standalone app) beats the product's default (`PUT /v1/product/settings`, per API key).
3. **Server default**: `OPENBLAH_LLM_PROVIDER` (and `OPENBLAH_LLM_MODEL`); otherwise Gemini Flash.

Each part can be missing; the level below fills it in. A setting is `{ llm: { provider, model? },
language?: "en" | "pt" }` (no `language` = follow what people speak). The agent name is per room.
`GET .../settings` returns the effective value, which level decided (`source`), whether it can run,
and each level. When the agent is dispatched, the server puts the resolved model and language in
the job metadata (`providers.llm`, `language`); a model change applies the next time the agent joins.

## Validation

A change is refused (409, `code: "no_key"`) unless the chosen provider has a usable key: the host's
own keys (BYOK needs the speech keys too, plus a key for the provider), the product's key set (it
may include `openai` and `claude`), or the free trial (Gemini only). `OPENAI_API_KEY` and
`ANTHROPIC_API_KEY` join the self-hosted key set. Keys can be saved for `openai` and `claude` with
the same key endpoints.

## Onboarding

`GET /v1/users/:userId/onboarding` (or `/v1/me/onboarding`) returns the copy, the providers (Gemini
first and `recommended`, with the free-key link), the keys still missing for each, the trial status
and the current setting. `POST .../keys/:provider/check` asks the vendor whether a key works
without storing it. `POST .../trial/start` picks Gemini for a signed-in user with trial left. In
React or React Native: `useOnboarding({ api, userId? })` from `@openblah/web` or
`@openblah/react-native`.

## Settings MCP tool

The server exposes `POST /mcp/settings` (MCP Streamable HTTP, stateless; bearer: a product API key
or the agent secret) with `get_settings`, `propose_settings_change` and `confirm_settings_change`.
Every call names `roomId` and `actorUserId`; only the host may change anything. This is the write
confirmation rule: a proposal changes nothing and returns a short-lived signed token and a
question; `confirm_settings_change` applies it only for the same person, room and token.

The agent worker uses it for voice ("switch to Claude"): it asks the question aloud and confirms
only in a **later** turn than the request, and only when the same person answers. The T13 approval
queue is not built yet; when it lands, the confirmation here can move onto it.
