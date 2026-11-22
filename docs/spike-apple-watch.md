# Spike T27: Apple Watch

**Status: partly done (T28 finished the server open items 1 and 2 below; see `docs/watch.md`). The server side exists and is tested. Nothing has been run on a watch yet**, because this session has no Xcode, no watch and no network access to a LiveKit server. The findings below that depend on Apple's or LiveKit's current behaviour are marked _unverified_ and are the first things to check with the steps at the end.

## Route chosen

**Route B: the watch streams audio over WebSocket to an OpenBlah endpoint that joins the room as a participant.** Route A (LiveKit Swift SDK on the watch) is checked first on the device, but B is chosen as the working plan because:

- _Unverified_: LiveKit's Swift SDK (`client-sdk-swift`) lists iOS, macOS, tvOS and visionOS. watchOS is not in its supported list as far as we know, and it depends on a WebRTC build that has no watchOS slice. Step 2 below confirms it in Xcode in a few minutes. If it builds and connects, use it and keep the protocol only for state and transcript.
- B needs no phone, matches the plan ("the watch always talks to the cloud itself"), keeps the watch thin, and keeps keys, limits and consent on the server.
- Route C (WatchConnectivity relay via the iPhone) is **not** built. It only works with the phone nearby, which the plan rules out as a final design. Try it only if B fails on the device.

## What is built

| Piece                                                                                                                                                   | Where                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Protocol, written down                                                                                                                                  | `docs/watch-protocol.md`            |
| Message parsing, signed one-minute tickets, `WatchSession` (the per-connection logic: start, mute, stop, state, transcript, audio relay, leave on drop) | `packages/server/src/watch.ts`      |
| `POST /v1/me/watch/ticket`, off unless `OPENBLAH_WATCH_SECRET` is set (the flag)                                                                        | `packages/server/src/app.ts`        |
| Tests: parsing, tickets, session flow, errors, endpoint on/off and membership                                                                           | `packages/server/src/watch.test.ts` |
| Bare watchOS app with recording, playback and the protocol                                                                                              | `spikes/watch/`                     |

## What is not built (open)

1. **The WebSocket listener.** `WatchSession` takes any transport; the `ws` (or `@hono/node-ws`) upgrade that feeds it frames is not wired in `main.ts`. About 30 lines once the dependency is chosen.
2. **The room link** (`RoomLink`): the server joining the LiveKit room as a participant, publishing the watch's audio, and delivering the agent's audio, state and transcript. This needs LiveKit's server-side RTC client (`@livekit/rtc-node`) and a test against a real room. It was not added blind because the native dependency and its Cloud Run image size need checking first. Agent state comes from participant attributes, transcript from the transcription stream.
3. Audio resampling and echo: the watch sends 16 kHz; LiveKit wants 48 kHz or 24 kHz, so the link resamples. Use `.voiceChat` mode on the watch (set in the spike) for echo cancellation.

## Apple's rules (_unverified, check against current docs_)

- **Microphone in the background.** watchOS lets a foreground app record. Background recording needs the `audio` background mode and a live audio session, and the system may suspend the app when the wrist drops. Expect a call to survive the screen turning off only while the audio session is active; test it (step 4). The spike sets `UIBackgroundModes: audio`.
- **Complication launching capture.** A complication can open the app, but it cannot start the microphone by itself. The tap opens the app in the foreground, and capture must start there: the app should begin a session on launch (or on one tap on a big Start button). Raise wrist, tap complication, app opens and auto-starts is the intended flow; T28 does that.
- **Microphone permission** is asked once on first use (`NSMicrophoneUsageDescription` is set).
- **Networking.** Direct WebSocket from a watch app is allowed (URLSessionWebSocketTask, watchOS 6+) on Wi-Fi or cellular, and through the phone when paired and nearby. Apple's guidance is to prefer URLSession over lower-level sockets; the spike does.

## Steps for Dani (on your Mac, with your watch)

1. `git checkout feat/t27-apple-watch-part-1`, then `brew install xcodegen`, then in `spikes/watch` run `xcodegen generate` and `open WatchSpike.xcodeproj`.
2. **Route A check:** uncomment the `dependencies:` lines in `project.yml`, run `xcodegen generate`, build for your watch. Note whether it builds. Report the error if not.
3. Set your team under Signing (a free profile is enough for testing), choose your watch, run it.
4. Until the bridge is finished, the app can only test audio and permissions: check that the microphone prompt appears, that recording starts from a tap, and that audio keeps running for 30 seconds after you lower your wrist (watch the Xcode console). Report both.
5. Report: A builds or not; background mic result; phone-away result (turn off the phone's Bluetooth and test on Wi-Fi).

## Decision for T28

Build on Route B unless step 2 shows LiveKit builds on watchOS. T28 first has to finish open items 1 and 2.
