# Rooms and the optional agent

A room is a plain voice call. The agent is optional: a call works fully with no agent, and in that state no audio goes to speech recognition (STT), the language model (LLM) or text to speech (TTS), because the agent worker is not running.

## The `agent` setting

| Value | Meaning                                                                        |
| ----- | ------------------------------------------------------------------------------ |
| `off` | A plain call. The agent cannot be started (the dispatch endpoints answer 409). |
| `on`  | The agent is in the call, in Listening, Facilitating or Direct mode (T9).      |
| `ask` | The default at creation. Off until someone invites the agent.                  |

Guests join an `off` or `ask` room without consent, because nothing is listening. In an `on` room they accept the consent line first.

## Who can change it

- By default only the **host** can bring the agent in or send it out.
- The room setting `anyoneCanAddAgent` lets any participant (member or guest) do both.
- Without that setting, a non-host who asks leaves a **request**. The host sees it in `requests` (and in the LiveKit room metadata as `agentRequests`) and approves or declines it. One pending request per person.
- **Voice requests to change state only work while the agent is present**, since only the running agent hears them. Asking it to leave ("Blah, leave the call") sends the agent out and puts the room back to `off` (the worker calls `POST /internal/rooms/:id/agent-off`). Asking it to stop listening only pauses it.

The agent worker is dispatched only when the state flips to `on` (and every consent is in). It leaves when the state flips to `off` (`stopAgent`: the dispatch is cancelled and the agent participant removed) and when the last human leaves the room.

## Late consent

When the agent is first brought in (the room goes from `off` or `ask` to `on`), **everyone is asked again**, even people who consented earlier:

1. The server records `agentConsentSince`. Consent given before that time no longer counts.
2. The room is `on` but waiting (`agentAwaitingConsent`, shown as `awaitingConsent` in the state). The agent is **not dispatched**, so it hears nobody.
3. Each participant sees the consent line (the T10 text, `GET /v1/rooms/:id/consent`, `useConsent()`) and accepts with `POST /v1/rooms/:id/consent`.
4. When the last missing consent arrives the server dispatches the agent. The host can instead set the room to `off` to keep it out.

A person who joins while the agent is on is also missing consent until they accept.

## Idle timeout

`idleTimeoutSeconds` (per room, host setting; default from the server, 5 minutes) is how long the room can be silent before the agent leaves. The worker reports silence; the server stops the agent (see `docs/costs.md`).

## API

All calls need the API key; `actorUserId` is the user the host's backend vouches for.

| Call                                                                  | Who                              | What                                                                                                                          |
| --------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/rooms/:id/agent?actorUserId=`                                | any participant                  | `agent`, `anyoneCanAddAgent`, `idleTimeoutSeconds`, `awaitingConsent`, `missing`, `requests` (host only), `canControl`        |
| `POST /v1/rooms/:id/agent/bring-in`                                   | any participant                  | Host (or anyone with the setting) turns it on: `status` is `on`, `awaiting_consent` or `refused`. Others get `202 requested`. |
| `POST /v1/rooms/:id/agent/send-out`                                   | host, or anyone with the setting | Agent leaves, room goes to `off` (or stays `ask`).                                                                            |
| `POST /v1/rooms/:id/agent/requests/:requestId/approve` and `/decline` | host                             | Answer a request.                                                                                                             |
| `PUT /v1/rooms/:id/agent`                                             | host                             | `agent`, `anyoneCanAddAgent`, `idleTimeoutSeconds` (any of them).                                                             |
| `POST /v1/rooms/:id/agent`                                            | trusted backend                  | Tap-to-start for a one to one call: refused when `off`; an `ask` room goes to `on` (the host's own app is the invitation).    |

## SDK: `useAgentControl()`

In both `@openblah/web/react` and `@openblah/react-native`:

```tsx
const agent = useAgentControl();
// agent.state      { agent, awaitingConsent, missing, requests, canControl, anyoneCanAddAgent, idleTimeoutSeconds } | null
// agent.present    true while the agent is in the call
// agent.bringIn()  / agent.request()   host: turn on; others: ask the host
// agent.sendOut()
// agent.approve(id) / agent.decline(id)   host
// agent.setAnyoneCanAdd(true) / agent.setIdleTimeoutSeconds(600)   host
```

It reloads on its own when the room changes. Pair it with `useConsent()` to show the consent line when `needed` is true. The dev page (`packages/web/dev`) and the example app (`apps/example`) show all of it.

## Limits of this version

- A person who joins while the agent is on without having consented is flagged by the server (`missing`) and the agent is not re-dispatched, but a running worker does not yet mute that one person's track; until they accept, the consent line is the only control. A worker-side per-track gate is a follow-up.
