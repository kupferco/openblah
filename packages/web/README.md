# @openblah/web

Web SDK for OpenBlah voice rooms: a framework-free client wrapping `livekit-client`, plus React hooks.

The client and hooks live in `@openblah/core`, shared with `@openblah/react-native`; this package re-exports them.

**0.x, unstable:** the API may change in any minor release.

## Core

```ts
import { OpenBlahClient } from "@openblah/web";

const client = new OpenBlahClient();
client.on("change", (s) => console.log(s.status, s.agentState, s.participants));
await client.connect("wss://your-project.livekit.cloud", token); // token from POST /v1/tokens
await client.setMuted(true);
await client.disconnect();
```

`getSnapshot()` returns `{ status, participants, muted, agentState, error }`. Events: `change`, `connected`, `disconnected`, `error`.

`agentState` is `listening | thinking | speaking | muted | unavailable`. It is read from the agent participant's `lk.agent.state` attribute; `unavailable` means no agent is in the room (the agent arrives in a later task).

## React

React is an optional peer dependency; hooks are at `@openblah/web/react`.

```tsx
import {
  OpenBlahProvider,
  useRoom,
  useParticipants,
  useAgentState,
  useMute,
} from "@openblah/web/react";
```

Wrap the app in `<OpenBlahProvider>`, then use `useRoom()` (status, connect, disconnect), `useParticipants()`, `useAgentState()` and `useMute()`.

## Invites, consent and host controls

Pass `api` so the client can call the OpenBlah server. The server API key belongs to your backend: point `baseUrl` at a proxy there that adds it (or return it from `headers` in a trusted environment). The guest calls (`getInvitePreview`, `joinWithInvite`) need no key.

```ts
const client = new OpenBlahClient({ api: { baseUrl: "https://your-backend.example/openblah/v1" } });
```

| Hook / method                                 | What it does                                                                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useRole()`                                   | `host`, `member`, `guest` or null. Each `ParticipantInfo` also has a `role`.                                                                                                                                                                                   |
| `useHostControls()`                           | `isHost`, `createInvite`, `revokeInvite`, `removeParticipant`, `endRoom` (the server rejects non-hosts).                                                                                                                                                       |
| `useInviteJoin(token)`                        | Guest side: `preview` (host name, agent name, consent text and version), `join(displayName, accepted)`. Consent is required unless the room's AI is off.                                                                                                       |
| `useConsent()`                                | For someone already in the room: `needed`, `text`, `accept()`.                                                                                                                                                                                                 |
| `useOnboarding({ api, userId? })`             | First-run setup you render yourself (no room needed): `intro` (suggests the free Gemini key first), `providers`, `select`, `missingKeys`, `keyUrl`, `checkKey`, `addKey`, `startTrial`, `finish`, `ready`. See [model settings](../../docs/model-settings.md). |
| `useAiPause()`                                | `paused` (true for everyone while the AI is paused), `setPaused`, `toggle`. Anyone can pause; the host or the person who paused can resume.                                                                                                                    |
| `useInviteRequests(handler)`                  | Host only: called when the agent was told "Blah, invite my mother". Show a contact picker or share sheet and resolve `"sent"` or `"declined"`.                                                                                                                 |
| `client.joinWithInvite(token, name, consent)` | Same as `useInviteJoin`'s `join`, without React. Needs `livekitUrl` in the options if the server sends none.                                                                                                                                                   |

While the AI is paused `useAgentState()` is `paused` and the agent says so aloud to anyone who joins.

Mid-call invite: `copyInviteLink(host)` (from `@openblah/web`) creates a link and copies it to the clipboard.

## Dev test page

```sh
pnpm --filter @openblah/web dev
```

Open http://localhost:5173. Open the "OpenBlah server" section and set the API URL (default `http://localhost:8080/v1`) and the API key (dev only). Host: join with a token, press "Invite (copy link)", open the link in a second browser, tick the consent box and join as a guest. "Pause AI" shows a banner in both. Or, with two plain tokens:

Open http://localhost:5173 in two tabs. Get two tokens from the T2 server (`POST /v1/tokens` for the same room, different users), paste the LiveKit URL and one token per tab, and press Join. Each tab should hear the other.
