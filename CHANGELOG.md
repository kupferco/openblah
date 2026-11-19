# Changelog

All notable changes to the published packages (`@openblah/core`, `@openblah/web`, `@openblah/react-native`, `@openblah/server`). The SDK packages share one version. OpenBlah is **0.x: the API may change in any minor release.**

## 0.1.0

First npm release.

- `@openblah/web` and `@openblah/react-native`: voice-room client, React hooks, the ready-made `<OpenBlahRoom />` component, theme and label helpers, `useRoomView`, public/internal API marking.
- `@openblah/core`: the shared client and hooks behind both SDKs (published because they depend on it; use the SDK packages instead).
- `@openblah/server`: the hosted voice server (tokens, API keys, invites, settings, agent dispatch).
- `@openblah/agent` is not published to npm. It ships as a Docker image built from `packages/agent/Dockerfile`.
