# @openblah/web

Web SDK for OpenBlah voice rooms: a framework-free client wrapping `livekit-client`, plus React hooks.

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

## Dev test page

```sh
pnpm --filter @openblah/web dev
```

Open http://localhost:5173 in two tabs. Get two tokens from the T2 server (`POST /v1/tokens` for the same room, different users), paste the LiveKit URL and one token per tab, and press Join. Each tab should hear the other.
