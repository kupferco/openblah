# Changelog

All notable changes to the published packages (`@openblah/core`, `@openblah/web`, `@openblah/react-native`, `@openblah/server`). The SDK packages share one version. OpenBlah is **0.x: the API may change in any minor release.**

## Unreleased

- `@openblah/core` (and so both SDKs): `OpenBlahApi.startCall` and `warmup` for signed-in app users, `client.setMode`, `useRoomMode` and `mode` in the snapshot.
- `@openblah/server`: `POST /v1/me/calls` and `POST /v1/me/warmup` (Firebase ID token).

## 0.1.0

First npm release.

- `@openblah/web` and `@openblah/react-native`: voice-room client, React hooks, the ready-made `<OpenBlahRoom />` component, theme and label helpers, `useRoomView`, public/internal API marking.
- `@openblah/core`: the shared client and hooks behind both SDKs (published because they depend on it; use the SDK packages instead).
- `@openblah/server`: the hosted voice server (tokens, API keys, invites, settings, agent dispatch).
- `@openblah/agent` is not published to npm. It ships as a Docker image built from `packages/agent/Dockerfile`.
