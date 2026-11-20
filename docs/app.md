# Standalone app (`apps/app`)

The installable OpenBlah app (T24), an Expo dev build. It uses **only the public SDK**
(`@openblah/react-native`). Where the SDK had a gap, the SDK was extended (see "SDK additions").
It does not run in Expo Go (native WebRTC), and it has not been run on a device yet.

## Screens and flow

```
sign in -> (onboarding, until a model can run) -> home -> consent -> call
                                                  \-> settings
```

| Screen     | What it does                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in    | Email link or Google through Firebase Auth (Q6). Sign in with Apple comes in T26.                                                                                            |
| Onboarding | `useOnboarding`: pick a model (Gemini suggested first), add your own key (with a link to get a free Gemini key) or start the 5-minute trial (Q2). Shown until a model works. |
| Home       | "Start talking": tap to start, no wake word.                                                                                                                                 |
| Consent    | Before the call with the agent: says it is an AI and shows the data terms from the server. Accepting is also sent to the server once the call is open.                       |
| Call       | Participants, the agent's state, mute, bring the agent in or out, and the Listening / Direct switch.                                                                         |
| Settings   | Model, key, language override (automatic, English, Portuguese), agent name (default "Blah", Q1, kept on the phone), sign out.                                                |

The warm-up ping (`POST /v1/me/warmup`) runs when the app opens and each time it comes to the
foreground. Background audio, screen lock and Bluetooth come from the SDK (T7); the app adds
the `audio` background mode through the SDK's config plugin in `app.json`.

## Code map

- `src/AppRoot.tsx`: the flow above. Takes `auth`, `api`, `client` and `prefs`, so tests inject fakes.
- `src/App.tsx`: the real wiring (Firebase auth, `createOpenBlahClient`, AsyncStorage).
- `src/auth/`: the `AuthService` interface and its Firebase implementation (`firebase.ts`, device only).
- `src/screens/`: one file per screen. `src/ui.tsx`: shared buttons and fields.
- `src/app.test.tsx`: the flow sign in, onboarding, call with the real SDK client and hooks over a fake LiveKit room and a fake server (`src/test-support/`). `react-native` is replaced by a small stub, and `@openblah/react-native` by the core SDK (alias in `vitest.config.ts`), since the native layer cannot run in node.

## SDK additions made for the app

- `OpenBlahApi.startCall({ displayName, agentName?, agent? })` and server `POST /v1/me/calls`: creates a room hosted by the signed-in user (Firebase ID token) and returns `{ roomId, token, livekitUrl? }`.
- `OpenBlahApi.warmup()` and server `POST /v1/me/warmup` (rate limited per user).
- `client.setMode(mode)`, `useRoomMode()` and `mode` in the client snapshot (read from the agent's `openblah.mode` attribute). Direct is host only.

## Settings it needs

Set these when starting or building (`EXPO_PUBLIC_*` values are public, never put a secret in them):

| Variable                                                                 | What                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_OPENBLAH_API`                                               | Server URL including `/v1`                                                              |
| `EXPO_PUBLIC_LIVEKIT_URL`                                                | Used only if the server sends no `livekitUrl` (set `LIVEKIT_URL` on the server instead) |
| `EXPO_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_APP_ID` | The Firebase web app of the project from T14                                            |
| `EXPO_PUBLIC_GOOGLE_CLIENT_ID`                                           | Google OAuth client id for "Continue with Google"                                       |
| `EXPO_PUBLIC_EMAIL_LINK_URL`                                             | An authorised Firebase domain URL the email link opens                                  |

The server must run with `FIREBASE_PROJECT_ID` so it can verify the ID tokens.

## Build on your iPhone (on a Mac)

```sh
pnpm install
pnpm --filter @openblah/react-native build
cd apps/app
npx expo prebuild
pnpm ios        # expo run:ios --device --port 8098
pnpm start      # later runs: the dev server on port 8098
```

A free Apple provisioning profile is enough (7-day signing). The app uses Metro port 8098 and the
example uses 8099, so both can sit on one Mac (see `docs/react-native.md` for why the port matters).

## Test login

Sign-in is the real Firebase email link or Google. This task adds no one-tap preview test login: the app is a
native build, not a web preview, so there is no preview URL to log into. If one is added later, follow the rules in `CLAUDE.md`.
