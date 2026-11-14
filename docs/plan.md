# OpenBlah plan

Status tags used on every item:

- **Decided**: from Dani's brief.
- **Recommended**: my proposal, open to change.
- **Verify**: a third-party fact to check before relying on it.

## 1. What OpenBlah is

- **Decided**: An open-source (MIT) voice layer, as fluent as Claude's voice mode, for Dani's own products and anyone else's.
- **Decided**: Dani will drop it once Anthropic, OpenAI or Google catch up. The value is being useful now and showing what's possible. So: keep it small, avoid lock-in, don't over-build.
- **Decided**: Main feature is multi-person voice calls with an AI agent in the middle (Dani and Penelope, his mother, a 3–4 person business meeting).
- **Decided**: The agent listens, takes notes, facilitates, gives its opinion when asked, searches, and sends or carries out tasks with the user's own tools (e.g. booking tickets or a restaurant for the group). It knows when to stay quiet.
- **Decided**: Vision is a "walking meeting room": phone in pocket, the room with the AI always available, others can be invited mid-conversation (e.g. his mother switches from WhatsApp and joins).
- **Decided**: MVP is voice only. No video or images.
- **Decided**: Native app is the main experience (phone and watch). A browser link (no install) is the accessibility path for guests.

## 2. Architecture

### 2.1 Components

- **Decided**: A standalone voice layer with its own server; npm packages for web and React Native/Expo dev builds; a Swift watch client later. Host apps (OpenPocket, Tera/TeraPay, Housekeeper) plug in.
- **Decided**: Built on LiveKit, starting on LiveKit Cloud free tier.
- **Recommended**: Four pieces:
  1. **LiveKit Cloud**: media (WebRTC SFU), rooms, participants.
  2. **OpenBlah server** (small TypeScript service, e.g. Hono/Node): issues LiveKit tokens, creates rooms and invites, stores room metadata, notes and consent records, dispatches the agent. Holds all secrets.
  3. **Agent worker**: a LiveKit Agents process (Node/TypeScript to match the packages) that joins each room as a participant and runs the voice pipeline.
  4. **Client packages**: `@openblah/web`, `@openblah/react-native`, later a Swift package. Thin wrappers over LiveKit client SDKs plus OpenBlah's join/invite/consent API.
- **Recommended**: Monorepo (pnpm workspaces) in kupferco/openblah: `packages/server`, `packages/agent`, `packages/web`, `packages/react-native`, `apps/guest-web` (the join page), `docs/`.
- **Verify**: LiveKit Agents' current JS/TS SDK maturity versus Python. If the TS agent lags (features, turn detection), use Python for the worker only; the packages stay TS.

### 2.2 Rooms

- **Recommended**: One LiveKit room per conversation. Room name is a random ID. Room persists as long as someone is in it; a "standing room" per user (the "always available" room) is a saved record in the OpenBlah server that creates the LiveKit room on demand.
- **Recommended**: The agent joins when the first human joins, and leaves when the last human leaves (no cost when empty).
- **Recommended**: Room metadata (host, host app, participants' display names, agent persona, tool set, consent state) lives in the OpenBlah server DB, mirrored to LiveKit room metadata for clients.
- **Recommended**: Mid-call invites: host taps "Invite", the server mints a link; the guest joins the same room. Nobody has to restart the call.

### 2.3 Voice pipeline

- **Recommended**: Start with the cascaded pipeline (STT → LLM → TTS) via LiveKit Agents, because group calls need per-speaker transcripts, a text channel for tools and notes, and model choice. Speech-to-speech models (OpenAI Realtime, Gemini Live) handle multiple speakers poorly and hide the transcript.
- **Recommended**: Defaults to try first, behind a provider interface so they are swappable:
  - **STT**: Deepgram streaming (fast, diarization-friendly), alternative AssemblyAI or OpenAI.
  - **LLM**: Claude (Sonnet-class for latency) as the default, since Dani's products are on Claude; interface allows OpenAI/Gemini.
  - **TTS**: Cartesia or ElevenLabs (low latency, natural), alternative OpenAI TTS.
- **Recommended**: Per-participant audio tracks: transcribe each human track separately, so the transcript knows who spoke without diarization guesses. Each line is tagged `[Penelope]: ...` in the LLM context.
- **Verify**: Current LiveKit Agents support for multiple simultaneous participants in one session (the default AgentSession targets one linked participant). Group mode may need one STT stream per participant managed by our own code. This is the biggest technical unknown; spike it first.
- **Verify**: LiveKit Cloud's built-in inference (bundled STT/LLM/TTS) vs bringing own API keys, and what the free tier includes.
- **Recommended**: Target end-to-end latency under ~1.2 s from end of speech to first agent audio for direct questions. Measure from day one.

### 2.4 Turn-taking and interruption

- **Recommended**: Use LiveKit's turn detector model plus VAD for end-of-turn, and allow barge-in: if any human speaks over the agent, the agent stops within ~300 ms and drops the unspoken rest.
- **Recommended**: Distinguish backchannel ("mm", "yeah") from real interruption; don't stop for backchannel.
- **Recommended**: Never speak over two humans talking to each other; wait for a pause of ~1 s.

### 2.5 When the agent speaks in a group

This is the product's core. Default is silent.

- **Recommended**: Three modes per room, switchable by voice or button:
  1. **Listening** (default for human-to-human talk): transcribes, takes notes, never speaks unless addressed.
  2. **Facilitating**: may speak briefly on its own to summarise, flag a decision, or note an open action, at natural pauses only.
  3. **Direct**: one-to-one with the host (the "walking" case).
- **Recommended**: Speak only when: (a) addressed by name ("Blah, ..."; wake word configurable), (b) asked by a person in the last turn for an opinion, (c) in Facilitating mode and a rule fires (decision reached, long silence after a question, time check requested).
- **Recommended**: Decision is made by a cheap, fast "should I speak?" classifier call on each finished turn (small model, outputs speak/stay-quiet + reason), separate from the main LLM. Logged for tuning.
- **Recommended**: Replies are short by default (1–3 sentences), longer only if asked.
- **Recommended**: Addressing is by name plus context: if Dani says "Blah, what do you think?" the agent answers; if he says "Penelope, what do you think?" it stays quiet. Eye-contact style cues don't exist, so name use is the main signal; the classifier uses recent turns.
- **Recommended**: Visible state on every client (listening / thinking / speaking / muted) so people trust it. A "mute the agent" control for everyone.

## 3. Identity and invites

- **Recommended**: Two participant types:
  - **App users**: authenticated via the host app. The host app's backend calls the OpenBlah server (server-to-server, API key) to mint a short-lived join token for its user. OpenBlah doesn't run its own user accounts in the MVP; it trusts the host app's user ID and display name.
  - **Browser guests**: no account. Join through an invite link containing a single-use or limited-use invite token; they enter a display name and consent, then join.
- **Recommended**: Invite link format `https://<host>/j/<token>`. Token is random, expires (default 24 h), tied to one room, revocable by the host. Opens the native app if installed (universal link), else the web page. This also covers the mother case: send the link on WhatsApp, she taps, it opens in the browser.
- **Recommended**: Guests are labelled "guest" in the room and have fewer rights: can't invoke tools on the host's accounts, can't change agent mode, can't see other participants' contact details.
- **Recommended**: Host controls: invite, remove participant, end room, set agent mode, approve tool actions.
- **Verify**: Universal links / App Links need an HTTPS domain and apple-app-site-association file; needs Dani's Apple developer account (see section 9).
- **Recommended**: The "invite mid-conversation" voice command: "Blah, invite my mother". The agent asks the host app for the contact (via a tool), and sends the link through a configured channel (SMS/share sheet); at first the share sheet is enough.

## 4. How host apps plug in

- **Recommended**: Packages:
  - `@openblah/server`: runnable server, also embeddable as a library.
  - `@openblah/web`: React hooks and a ready component (`<OpenBlahRoom />`), vanilla JS core.
  - `@openblah/react-native`: same API for Expo dev builds (needs native modules via `@livekit/react-native`, so Expo Go won't work). **Verify** the current LiveKit RN + Expo config plugin setup.
  - Swift package later for the watch.
- **Recommended**: Host app integration in three steps: (1) backend calls `POST /v1/rooms` and `POST /v1/tokens` with its OpenBlah API key; (2) client mounts the component with the token; (3) host registers tools.
- **Recommended**: Agent tools come from the host app in two ways:
  1. **MCP servers**: the host lists MCP server URLs (plus per-user auth) on room creation; the agent connects as an MCP client. Matches "carries out tasks with the user's own tools".
  2. **Webhook tools**: simple JSON-schema tool definitions with a callback URL, for apps that don't run MCP.
- **Recommended**: Tool safety: read-only tools (search, lookup) run freely. Tools that change anything (book, send, pay) require spoken or tapped confirmation from the host before running, with the agent reading back what it will do ("Book a table for four at 19:30 at X, OK?"). In a group, confirmation comes from the owner of the tool credentials, not any participant.
- **Recommended**: Agent built-ins: notes, summary, action list, web search (via a search tool/MCP), and the invite command.
- **Decided**: Housekeeper's current mic button is a bad voice experience; replacing it is the first real use case. **Recommended**: Do it as the first integration (chunk 8), since it is single-user and low risk, before the group features are polished.

## 5. Native apps and watch

- **Decided**: Native app is the primary experience. **Open**: Is the first OpenBlah app a standalone "OpenBlah" app or just the reference inside OpenPocket? See Open questions.
- **Recommended**: MVP client is an Expo dev-build reference app (iOS first) that exercises the package; it doubles as the demo.
- **Recommended**: Background audio and "phone in pocket": enable iOS background audio mode and the audio session category `playAndRecord` so the call survives screen lock. Bluetooth/AirPods as the normal route.
- **Verify**: iOS behaviour for mic access in background with LiveKit's RN SDK, and CallKit integration needs (CallKit makes it feel like a call and keeps the session alive, but adds complexity).
- **Decided**: Apple Watch: complication (raise wrist, tap, talk). Dani has a regular Apple Watch, not an Ultra (no Action Button).
- **Verify**: Whether LiveKit's Swift SDK works on watchOS. If not:
- **Recommended fallback**: the watch records and plays audio itself and talks to the iPhone over WatchConnectivity (phone relays into LiveKit), or streams audio straight to the OpenBlah server over WebSocket, which bridges into the room as a participant. Phone relay is simpler for the first try; direct-to-server is needed for a watch without the phone nearby (cellular model).
- **Recommended**: Watch work comes after the phone MVP works. It is a spike first (chunk 11), no commitment.
- **Decided**: Android watches later.
- **Verify**: Whether a watchOS complication can launch directly into an active audio capture (watchOS limits background microphone use; the tap opens the app in the foreground). Check Apple's current rules.

## 6. Costs and free-tier limits

All numbers are to be checked on the live pricing pages before launch.

- **Verify**: LiveKit Cloud free ("Build") plan: monthly allowance of WebRTC participant minutes, concurrent participant limit, bandwidth, and agent session minutes. My memory is that it covers a modest number of minutes per month and a small number of concurrent connections; confirm exact figures and whether hosting the agent worker on LiveKit Cloud is included or the worker must be self-hosted.
- **Recommended**: Per-minute cost model, to put into the README:
  `cost/min ≈ LiveKit participant-minutes (humans + agent) + STT (per audio minute, per human track) + TTS (per character spoken) + LLM (tokens in/out)`.
  Note STT is billed per human track, so a 4-person call costs about 4x the STT of a 1:1 call even if only one person talks. Mitigation: only send audio to STT when VAD detects speech.
- **Recommended**: Rough budget goal: keep a 1:1 voice session near a few cents per minute and a 4-person call below ~10 cents per minute in provider costs. **Verify** against real prices; treat this as a target, not a fact.
- **Recommended**: Cost controls in the server: per-room max duration, idle timeout (agent leaves after N minutes of silence), per-host monthly minute cap, and a usage log per room so Dani can see costs.
- **Recommended**: Self-hosting later: LiveKit is open source, so moving off Cloud is possible if costs grow. Not needed for MVP.
- **Recommended**: Free tiers of STT/TTS/LLM vendors are enough for development; budget paid keys for testing the group case.
- **Decided**: Start on LiveKit Cloud free tier.
- **Recommended**: Hosting for the OpenBlah server and agent worker: a small container host (Fly.io, Railway or Cloud Run). The agent worker needs a long-lived process, not serverless functions. **Open**: Dani's preference; see Open questions.

## 7. Privacy

- **Recommended**: Principle: nothing is recorded or stored without everyone in the room knowing.
- **Recommended**: Consent flow:
  - Every participant (app and guest) sees, before joining, a plain line: "An AI listens to this call and takes notes. Audio is not saved. Transcript and notes are saved for the host."; they must tap to join.
  - The agent says on entry, "Blah is here and listening," and again when someone joins.
  - Anyone can ask the agent to stop listening, or leave; a "pause AI" control mutes the agent's listening for everyone with a visible indicator.
- **Recommended**: Defaults: **no audio recording**. Audio is streamed to STT and discarded. Transcript kept in memory during the call; notes and summary saved only if the host turns "save notes" on, and shared with participants who were present (by link) rather than only the host.
- **Recommended**: Raw transcript not kept after the call by default; only the notes/summary. Configurable retention (e.g. 30 days) and a delete button for the host.
- **Recommended**: Third-party processors (LiveKit, STT, LLM, TTS) see audio/text in transit. List them in the README and the consent text. Prefer providers with a no-training/zero-retention option. **Verify** each provider's data retention and training terms.
- **Recommended**: Legal note (not legal advice): recording and transcription consent laws differ by country and some require all-party consent. All-party consent at join, as above, is the safe design. Dani is in an EU-adjacent context (**Open**: where he and his users live), so GDPR applies: data minimisation, deletion, a processors list.
- **Recommended**: If a participant declines the AI, the host can leave AI off; the room still works as a normal call. **Open**: do we want the call to work with no AI at all? Cheap to keep, since it is just a LiveKit room.
- **Recommended**: Tool actions are logged (who asked, what ran) for the host to review.

## 8. MVP scope

- **Decided**: Voice only. Native app first-class, browser guest link.
- **Recommended**: In the MVP:
  - Create a room, join from the iOS dev build, invite someone by link, they join in a browser.
  - Agent with Listening / Direct modes, addressed by name, interruption handling, "should I speak?" classifier.
  - Notes and a post-call summary.
  - Consent screen and visible agent state.
  - One real tool path: MCP (read-only search plus one confirmed action).
  - Housekeeper integration replacing the mic button.
- **Recommended**: Not in the MVP: Facilitating mode tuning, watch app, Android, video, images, recordings, persistent standing rooms, push notifications for incoming calls, phone-number dialling, multiple languages, billing.
- **Recommended**: Success test for the MVP: Dani and Penelope have a 10-minute call with the agent in the room, the agent stays silent while they talk to each other, answers when asked, and produces correct notes.

## 9. Apple developer account

- **Decided**: Dani is moving apps toward the App Store and will get his own Apple developer account.
- **Recommended**: Until then, use the free-provisioning dev build on his own device for testing (limited: 7-day signing, no push, no associated domains). The paid account is needed for TestFlight, universal links and background modes in practice. Chunks that need it are marked below.
- **Verify**: Which capabilities (Associated Domains, background audio) work with a free account.

## 10. Implementation chunks

Each is sized as one Viber task (a few hours of coding session, one PR, testable). Order matters.

1. **Repo scaffold**: pnpm monorepo, TypeScript config, lint, test setup, CI, empty packages, `.env.example`. No LiveKit yet.
2. **Server core**: token endpoint, room create/get, API key auth, health check, tests; LiveKit server SDK. Needs a LiveKit Cloud project (owner step: create project and set secrets).
3. **Web client + guest page**: `@openblah/web` core and `apps/guest-web` that joins a room with a token, shows participants, mute, and agent state. Two browser tabs can talk.
4. **Single-user agent**: agent worker joins a room, STT → LLM → TTS with Direct mode, barge-in and turn detection. Provider interfaces. Latency logging. Owner step: API keys.
5. **Spike: multi-participant agent**: per-participant STT streams, speaker-tagged transcript, "should I speak?" classifier. Offline-testable with recorded audio fixtures. Answers the main Verify in 2.3.
6. **Group behaviour**: Listening / Facilitating / Direct modes, name addressing, mute-agent control, notes and summary generated at the end.
7. **Invites and consent**: invite tokens, expiry and revoke, consent screen and agent announcement, guest rights, host controls.
8. **Tools**: MCP client in the agent, webhook tools, confirmation flow for write actions, action log.
9. **React Native / Expo package and reference app**: `@openblah/react-native`, dev-build demo, background audio, Bluetooth routing. Needs the iOS device build (owner step).
10. **Housekeeper integration**: replace the mic button using the RN package; collect feedback. Separate PR in the Housekeeper repo; this repo gets an integration guide.
11. **Watch spike**: test LiveKit Swift SDK on watchOS; if it fails, prototype the phone-relay fallback; document findings. Owner step: Xcode and device.
12. **Watch complication MVP**: raise-wrist, tap, talk on top of the spike result.
13. **Privacy and cost controls**: retention settings, delete, usage log, per-room and per-host caps, README processors list.
14. **Docs and release**: README quickstart, host integration guide, npm publish, demo video script, licence check.
15. **Later**: OpenPocket and Tera/TeraPay integrations, Android watch, standing rooms, push-based calling.

Chunks 1–4 give a working 1:1 voice agent early; chunk 5 de-risks the group feature before more is built on it.

## 11. Risks

- **Recommended**: Group-aware agent behaviour (knowing when to stay quiet) is hard and may feel wrong; mitigate with the classifier log and quick tuning loops using recorded fixtures.
- **Recommended**: Provider platforms may add the same feature soon; that is accepted by the brief. Keep the work small and swap-friendly.
- **Verify**: watchOS support and background mic limits (section 5).
- **Recommended**: Per-minute cost with many participants (section 6).

## Open questions

1. Is the first native app a standalone OpenBlah app, or a demo screen inside OpenPocket?
2. What should the agent be called, and what's its wake word? "Blah"?
3. Where do you and your family live, and which countries will users be in?
4. Should the agent answer in the language people speak, and which languages do you need first?
5. Do you prefer Claude as the default brain, even if it's a bit slower than a smaller model?
6. Is TypeScript for the agent worker fine, or do you prefer Python if the TS one lags?
7. Which host do you want for the server: Fly.io, Railway, Cloud Run, or something else?
8. Do you already have a domain for invite links, and what is it?
9. When do you expect the Apple developer account to be ready?
10. Should notes be sent to everyone in the call after, or only to the host?
11. Should the call work with the AI turned off for people who decline it?
12. Which action should be the first booking tool: restaurant, tickets, or something else?
13. For the watch, should it work without the phone nearby, or is phone-in-pocket enough?
14. What monthly spend on provider fees are you comfortable with while testing?
