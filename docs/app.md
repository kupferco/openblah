# Standalone app (`apps/app`)

The installable OpenBlah app (T24, extended in T25), an Expo dev build. It uses **only the public SDK**
(`@openblah/react-native`). Where the SDK had a gap, the SDK was extended (see "SDK additions").
It does not run in Expo Go (native WebRTC), and it has not been run on a device yet.

## Screens and flow

```
sign in -> (onboarding, until a model can run) -> home -> consent -> call
                                                  |-> call history -> one call
                                                  |-> tools (MCP servers)
                                                  \-> settings
```

| Screen     | What it does                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in    | Email link or Google through Firebase Auth (Q6). Apple too in a paid-account build (T26).                                                                                    |
| Onboarding | `useOnboarding`: pick a model (Gemini suggested first), add your own key (with a link to get a free Gemini key) or start the 5-minute trial (Q2). Shown until a model works. |
| Home       | "Start talking" (tap to start, no wake word), Call history, Tools, Settings.                                                                                                 |
| Consent    | Before the call with the agent: says it is an AI and shows the data terms from the server. Accepting is also sent to the server once the call is open.                       |
| Call       | Participants, the agent's state, mute, bring the agent in or out, and the Listening / Direct switch.                                                                         |
| Settings   | Model, key, language override (automatic, English, Portuguese), agent name (default "Blah", Q1, kept on the phone), sign out.                                                |

The warm-up ping (`POST /v1/me/warmup`) runs when the app opens and each time it comes to the
foreground. Background audio, screen lock and Bluetooth come from the SDK (T7); the app adds
the `audio` background mode through the SDK's config plugin in `app.json`.

## Invites, MCP servers and history (T25)

- **Invite**: "Invite someone" in the call creates a link (`createInvite`) and opens the share sheet (`shareInvite`). The guest opens `https://openblah.web.app/j/<token>` in the browser page (T29) until universal links exist (T26). Works in a 1:1 Direct call or a group, with the agent in or out.
- **Tools** (home): add an MCP server by URL. `connectMcpInApp` runs the full OAuth sign-in in an in-app browser sheet (`expo-web-browser`), so no credentials are typed or spoken in the app. Each server can be tested (`Test`) and disconnected (tokens are deleted on the server). Set `EXPO_PUBLIC_MCP_RETURN_URL` if the server needs the browser to return to the app (it must be allowed in the server's settings).
- **Tools per room**: the host switches saved servers on or off in the call screen. New rooms start with all saved servers on; the choice (`PUT /v1/rooms/:id/mcp-servers`) applies the next time the agent joins. `startCall({ mcpConnectionIds })` can also set it at the start.
- **Room settings** (host, in the call): "Save notes" (history) and "Anyone can add <agent>".
- **Call history** (home): the calls you were in, with summary, notes, actions and transcript (`useHistory`, `useCall`). The host also sees retention (30 days, 1 year, until deleted) and "Delete this call".

### Server change this needed

The room routes (`/v1/rooms/:id/...`, `/v1/history`) only accepted the product API key. A signed-in app user now reaches a fixed list of them (invites, history, history settings, consent, participants, permissions, agent control, per-room tools) with their Firebase ID token, and only as themselves: every `actorUserId`/`userId`/`viewerUserId` in the query or body must equal their verified uid (else 403, and a request naming nobody is refused). Product-level routes (`/rooms`, `/tokens`, product settings, agent dispatch) stay API-key only. See `packages/server/src/me-v1.test.ts`.

## Manual checks (not run on a device)

1. Tools: add a real MCP server you control, complete its sign-in, tap Test, then Start talking and ask the assistant to use it.
2. In the call, tap Invite someone, send the link to a second device, and join from the browser page.
3. Turn on Save notes, end the call, then open Call history and read the summary and transcript.
4. As host, change retention and delete the call; check it is gone from the list.

## Code map

- `src/AppRoot.tsx`: the flow above. Takes `auth`, `api`, `client` and `prefs`, so tests inject fakes.
- `src/App.tsx`: the real wiring (Firebase auth, `createOpenBlahClient`, AsyncStorage).
- `src/auth/`: the `AuthService` interface and its Firebase implementation (`firebase.ts`, device only).
- `src/screens/`: one file per screen (`Servers.tsx` and `History.tsx` are T25). `src/ui.tsx`: shared buttons and fields.
- `src/app.extras.test.tsx`: the T25 screens (MCP servers, invite, room settings, history) with the same fakes.
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

## Release (T26)

For now the app is a **free account build**: signed with your own Apple ID in Xcode, on your own iPhone, re-signed every 7 days. TestFlight, Sign in with Apple and universal links need the paid Apple account and are off by default behind `EXPO_PUBLIC_OPENBLAH_PAID_APPLE=1`; see `docs/release-ios.md`. The email link comes back to the app through the `openblah://signin?link=...` scheme (page `hosting/public/signin/`), and `openblah://j/<token>` is read as an invite (`src/invite-link.ts`); joining from an invite is T25.

## Free account build

Short version (full steps in `docs/release-ios.md`):

```sh
pnpm install && pnpm --filter @openblah/react-native build
cd apps/app && npx expo prebuild --platform ios --clean
open ios/OpenBlah.xcworkspace
```

In Xcode: add your Apple ID (Settings > Accounts), pick your **Personal Team** under Signing & Capabilities (automatic signing), choose your plugged-in iPhone (Developer Mode on), press Run, then trust the profile on the phone (Settings > General > VPN & Device Management). Start the dev server with `pnpm start` (port 8098; the example uses 8099, so both can sit on one Mac, see `docs/react-native.md`). After **7 days** the app stops opening: plug the phone in, open the workspace again and press Run.

## Test login

Sign-in is the real Firebase email link or Google. This task adds no one-tap preview test login: the app is a
native build, not a web preview, so there is no preview URL to log into. If one is added later, follow the rules in `CLAUDE.md`.
