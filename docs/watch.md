# Apple Watch app (T28)

A watchOS app and complication: raise your wrist, tap, talk. It is a thin audio client for the protocol in `docs/watch-protocol.md`; the agent, tools, keys and limits all stay on the server. The watch talks to the cloud itself (Wi-Fi, cellular, or through the iPhone when it is near), so it works with the phone nearby or away. Wear OS is out of scope.

Route: the watch streams audio over a WebSocket to the OpenBlah server, which joins the LiveKit room as the user's "watch" participant (`<uid>~watch`). This is the route chosen in `docs/spike-apple-watch.md`. LiveKit's Swift SDK is not used on the watch.

## What is where

| Piece                                                                                                                   | Where                                      |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Watch app: start/stop/mute screen, agent state, latest transcript line, auto-start from complication                    | `apps/watch/OpenBlahWatch/`                |
| Complication (WidgetKit, taps open `openblah-watch://start`)                                                            | `apps/watch/Complication/`                 |
| Sign-in carried over from the phone (Keychain, refresh through Google's token endpoint)                                 | `apps/watch/OpenBlahWatch/AuthStore.swift` |
| WebSocket listener at `/v1/watch/socket`                                                                                | `packages/server/src/watch-socket.ts`      |
| Room link: joins LiveKit with `@livekit/rtc-node`, publishes the watch audio, returns agent audio, state and transcript | `packages/server/src/watch-link.ts`        |
| Session logic, tickets, protocol                                                                                        | `packages/server/src/watch.ts`             |
| `POST /v1/me/watch/ticket` (starts a call when no `roomId` is given)                                                    | `packages/server/src/app.ts`               |

## Server setup

Set both on the server (the bridge is off without the first one, and the ticket endpoint answers 404):

- `OPENBLAH_WATCH_SECRET`: a long random string that signs the one-minute tickets.
- `OPENBLAH_WATCH_SOCKET_URL`: the public `wss://<server>/v1/watch/socket` URL.

The watch socket needs a server that keeps WebSocket connections open: on Cloud Run set a request timeout of 3600 s and make sure the service allows WebSockets and has at least one warm instance during use. `@livekit/rtc-node` is a native module; it is loaded only when the bridge is on.

## Sign-in carried over from the phone

The watch never shows a login. The phone app signs in with Firebase Auth and sends the **refresh token** to the watch with `WCSession.updateApplicationContext(["refreshToken": "..."])` (and `["signedOut": true]` on sign-out). The watch stores it in its own Keychain and exchanges it for ID tokens itself, which is why it keeps working with the phone away. Until the phone has sent it, the watch shows "Open OpenBlah on your iPhone to sign in".

**Open: the phone side is not written.** `apps/app` is an Expo app with no native iOS project yet, so there is no WatchConnectivity bridge. It needs a small native module (or a library such as `react-native-watch-connectivity`) that calls the line above after sign-in. Add it with the iOS release work (T26), when the app has a native project and the paired watch app is embedded. Until then, to test, write the token by hand (below).

## Build and install

You need a Mac with Xcode 15 or later and an Apple Watch. A free provisioning profile is enough to test; the paid account is needed to distribute.

1. `git checkout feat/t28-apple-watch-part-2`, then `brew install xcodegen`.
2. In `apps/watch/project.yml` set `SERVER_URL`, `FIREBASE_API_KEY` (the Firebase web API key) and uncomment `DEVELOPMENT_TEAM`.
3. In `apps/watch` run `xcodegen generate`, then `open OpenBlahWatch.xcodeproj`.
4. Build the `OpenBlahWatch` scheme for your watch and run it. Allow the microphone when asked.
5. Add the complication: long-press the watch face, Edit, pick a slot, choose OpenBlah.

The Swift code was written without a Mac in reach: it parses, but it has **not been compiled or run**. Expect to fix small build errors on the first build and report them.

### Testing without the phone app

Until the phone bridge exists, put a refresh token into the watch by temporarily calling `saveRefreshToken("<token>")` in `AuthStore.init` (do not commit it). Get a token by signing in to the standalone app and reading `user.refreshToken` from Firebase Auth.

## Test checklist (Dani)

1. **Phone nearby:** raise wrist, tap the complication. The app opens, says "Connecting…", then "Blah is listening". Talk; the agent answers through the watch speaker. The latest line shows under the status. Mute and Stop work.
2. **Phone away:** turn off the phone's Bluetooth with the watch on Wi-Fi (or cellular) and repeat.
3. Lower the wrist during a call: note whether audio continues (background audio mode is set; see the spike report for what to expect) and report.
4. Confirm the room shows a participant named "Watch" in the phone app or dev page.

## Server tests

`pnpm exec vitest run packages/server/src/watch` covers the protocol, tickets, session flow, the endpoint (flag off, membership, new call), and the real WebSocket listener with a mocked room link. The LiveKit room link itself (`watch-link.ts`) has only its PCM helpers tested: it needs a real LiveKit room, which this environment does not have. That is the first thing to check on a real server.

## Limits

- Audio is 16 kHz mono; quality is for speech only.
- Echo: `.voiceChat` mode on the watch gives echo cancellation, but loud speaker playback can still feed back. Test it.
- A session ends when the socket drops; the watch shows "Connection lost" and starts a new call on the next tap. There is no automatic rejoin.
