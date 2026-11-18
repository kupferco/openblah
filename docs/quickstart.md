# Quickstart: a voice room in your app in 15 minutes

You need a running OpenBlah server (see [deploy.md](deploy.md)), its URL, and an API key from `OPENBLAH_API_KEYS`. The API key stays on your backend.

## 1. Backend: create a room and a token (2 minutes)

```ts
const base = "https://your-openblah-server.example/v1";
const headers = {
  authorization: `Bearer ${process.env.OPENBLAH_API_KEY}`,
  "content-type": "application/json",
};

const room = await fetch(`${base}/rooms`, {
  method: "POST",
  headers,
  body: JSON.stringify({ hostUserId: "user-1", hostDisplayName: "Maria", agent: "ask" }),
}).then((r) => r.json());

const { token } = await fetch(`${base}/tokens`, {
  method: "POST",
  headers,
  body: JSON.stringify({ roomId: room.id, userId: "user-1", displayName: "Maria" }),
}).then((r) => r.json());
// Send `token` and your LiveKit URL (wss://…) to the signed-in user's client.
```

`agent` is `on`, `off` (a plain call) or `ask` (the agent joins when someone invites it).

## 2. Web: mount the component (3 minutes)

```sh
npm install @openblah/web react react-dom
```

```tsx
import { OpenBlahProvider, OpenBlahRoom } from "@openblah/web/react";

export function Call({ serverUrl, token }: { serverUrl: string; token: string }) {
  return (
    <OpenBlahProvider>
      <OpenBlahRoom serverUrl={serverUrl} token={token} />
    </OpenBlahProvider>
  );
}
```

That gives you join, mute, the participant list, agent state and the pause control. For invites, consent, agent control and the host buttons the component needs to call the OpenBlah server: create the client yourself and point `api.baseUrl` at a proxy on your backend that adds the API key.

```tsx
import { OpenBlahClient } from "@openblah/web";
const client = new OpenBlahClient({ api: { baseUrl: "/api/openblah/v1" } });
// <OpenBlahProvider client={client}>
```

## 3. React Native / Expo: same component (5 minutes)

Needs an Expo **dev build** (not Expo Go); see [react-native.md](react-native.md) for the config plugin.

```sh
npx expo install @openblah/react-native @livekit/react-native @livekit/react-native-webrtc livekit-client
```

```tsx
import { OpenBlahProvider, OpenBlahRoom, createOpenBlahClient } from "@openblah/react-native";

const client = createOpenBlahClient({
  api: { baseUrl: "https://your-backend.example/openblah/v1" },
});

export default function Call({ serverUrl, token }: { serverUrl: string; token: string }) {
  return (
    <OpenBlahProvider client={client}>
      <OpenBlahRoom serverUrl={serverUrl} token={token} />
    </OpenBlahProvider>
  );
}
```

## 4. Make it yours

- **Theme**: `theme={{ accent: "#7c3aed", radius: 4 }}` (see `OpenBlahTheme`).
- **Words and translation**: `labels={{ join: "Entrar", leave: "Sair" }}` (see `OpenBlahLabels`).
- **Hide a part and build your own** with the hooks: `hide={["participants"]}`, then render `useParticipants()` yourself. Every part of the component is built from public hooks (`useRoom`, `useMute`, `useParticipants`, `useAgentState`, `useAgentControl`, `useConsent`, `useToolApprovals`, `useHostControls`, `useAiPause`). `useRoomView` returns all of them at once.
- **Try without a backend**: `pnpm --filter @openblah/web dev` opens the dev test page (paste a URL and token; add `?ready` for the ready component).

Next: [host-integration.md](host-integration.md). Every export is in [api-reference/](api-reference/README.md).
