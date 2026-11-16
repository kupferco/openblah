# React Native SDK (`@openblah/react-native`)

0.x, unstable. Same API as `@openblah/web`: the client and hooks both come from the shared `@openblah/core` package, so `OpenBlahClient`, `useRoom`, `useParticipants`, `useAgentState` and `useMute` behave the same on both.

**Expo dev builds only. It does not run in Expo Go**, because it needs native WebRTC modules (`@livekit/react-native-webrtc`).

The "warm-up call" mentioned in the T7 brief does not exist in `@openblah/web` yet (it arrives with T5, the warm-up endpoint), so it is not in either SDK. It will be added to `@openblah/core` and so to both.

## Install

```sh
npx expo install @openblah/react-native @livekit/react-native @livekit/react-native-webrtc livekit-client
```

Add the config plugin to `app.json`. It applies the LiveKit and WebRTC plugins (checked against `@livekit/react-native-expo-plugin` 1.1 and `@config-plugins/react-native-webrtc` 15), the iOS `audio` background mode, the microphone usage text and the Android audio permissions:

```json
{
  "expo": {
    "plugins": [
      ["@openblah/react-native/plugin", { "microphonePermission": "Why you need the mic" }]
    ]
  }
}
```

In the entry file, register the globals before anything else:

```js
import { registerOpenBlahGlobals } from "@openblah/react-native";
registerOpenBlahGlobals();
```

## Use

```tsx
import { OpenBlahProvider, createOpenBlahClient, useRoom, useMute } from "@openblah/react-native";

const client = createOpenBlahClient(); // OpenBlahClient plus the native audio session
// <OpenBlahProvider client={client}> ... useRoom().connect(serverUrl, token) ...
```

Tokens come from the OpenBlah server (`POST /v1/tokens`). See `apps/example/src/App.tsx`.

## Audio: screen lock and Bluetooth

`createOpenBlahClient` sets the iOS audio category to `playAndRecord` (mode `voiceChat`, options `allowBluetooth`, `allowBluetoothA2DP`, `defaultToSpeaker`) and starts the LiveKit audio session before connecting, and stops it after leaving. Together with the `audio` background mode the call keeps running with the screen locked, and routes to AirPods or other Bluetooth headsets when connected. `registerOpenBlahGlobals` turns off the library's automatic audio session management so this configuration is the one that applies.

This is set up from the library docs and unit-tested with a mock, but not yet checked on a device. Test lock screen and AirPods on a real iPhone and report problems.

## Build the example app (on a Mac)

```sh
pnpm install
pnpm --filter @openblah/react-native build   # the example resolves the SDK from dist
cd apps/example
npx expo prebuild
npx expo run:ios --device
```

A free Apple provisioning profile is enough (7-day signing); no paid account is needed yet. After the app is installed, start the dev server with `pnpm start` in `apps/example`. Enter the LiveKit URL and a token from the server, and press Join. To test, join the same room from the T3 web test page in a second tab.

Android: `npx expo run:android` works the same way (not tested yet).

## Checks in CI

`pnpm typecheck` compiles the SDK and the example app against the SDK source, so the example is checked in CI without a native build. `pnpm test` runs the hook tests (in `packages/core`), the audio and client tests with a mocked native layer, and the config plugin tests.
