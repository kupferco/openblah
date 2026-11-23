# Changelog

All notable changes to the published packages (`@openblah/core`, `@openblah/web`, `@openblah/react-native`, `@openblah/server`). The SDK packages share one version. OpenBlah is **0.x: the API may change in any minor release.**

## 0.2.1

SDK packages (`core`, `web`, `react-native`) 0.2.1.

- `@openblah/web` (via `@openblah/core`): the agent's voice is now played in the browser. Remote audio tracks are attached to a hidden `<audio>` element, `room.startAudio()` runs after connecting, and `audioBlocked` plus `client.startAudio()` let an app show "tap to hear" if autoplay is blocked. React Native is unchanged.

## 0.2.0

SDK packages (`core`, `web`, `react-native`) 0.2.0; `@openblah/server` 0.1.1.

- `@openblah/web` and `@openblah/react-native`: drop-in `<OpenBlahMicButton />` (voice only, app-wide single session, halo for listening, thinking and speaking, compact write-action confirmation, themable). `@openblah/core`: `useMicButton`, `client.startOnce`, mic labels.
- `@openblah/core` (and so both SDKs): `OpenBlahApi.startCall` and `warmup` for signed-in app users, `client.setMode`, `useRoomMode` and `mode` in the snapshot.
- `@openblah/server`: `POST /v1/me/calls` and `POST /v1/me/warmup` (Firebase ID token).
- `@openblah/server`: Apple Watch bridge behind `OPENBLAH_WATCH_SECRET`: WebSocket at `/v1/watch/socket`, LiveKit room link, `POST /v1/me/watch/ticket` starts a call when no `roomId` is given (see `docs/watch.md`).

## 0.1.0

First npm release.

- `@openblah/web` and `@openblah/react-native`: voice-room client, React hooks, the ready-made `<OpenBlahRoom />` component, theme and label helpers, `useRoomView`, public/internal API marking.
- `@openblah/core`: the shared client and hooks behind both SDKs (published because they depend on it; use the SDK packages instead).
- `@openblah/server`: the hosted voice server (tokens, API keys, invites, settings, agent dispatch).
- `@openblah/agent` is not published to npm. It ships as a Docker image built from `packages/agent/Dockerfile`.
