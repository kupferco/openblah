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
- **Decided**: The agent is optional per room. People can use OpenBlah just to talk to each other, and bring the agent in or out at any time (section 2.6).
- **Decided**: OpenBlah is also a voice client for MCP tools. Claude's voice mode works well with MCP connectors, but ChatGPT and Gemini don't. People on those assistants, or none, can talk to their MCP tools by voice through OpenBlah. Products (TeraPay, Housekeeper, OpenPocket) can embed it to give users voice access to the product's MCP tools without a ChatGPT/Claude/Gemini account (section 4).

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

### 2.6 Group calls and the optional agent

- **Decided**: 2–3+ people can talk in one room with the AI agent in the middle if they want. The agent is optional per room: a room can be a plain voice call between people, and the agent can be brought in or sent out at any time.
- **Recommended**: A room has an `agent` state: `off` (plain call), `on` (agent present, in Listening/Facilitating/Direct mode). Any app user in the room can request the agent ("Blah, join" by button; by voice only when the agent is already present). Host approves by default, so a guest cannot silently bring an AI into a call.
- **Recommended**: Agent worker is dispatched only when the state flips to `on`, and leaves when it flips to `off`. In `off` state no audio goes to STT/LLM/TTS, so a plain call costs only LiveKit minutes and no AI processing happens. Consent (section 7) is asked when the agent first joins, not only at room start, so people who joined an AI-free room agree before it starts listening.
- **Recommended**: Rooms are created with `agent: on | off | ask` by the host app; default `ask` (agent off until someone invites it).
- **Recommended**: Group size target: 2–4 humans in the MVP; "3+" beyond that is not tuned. **Verify** LiveKit limits per room on the free plan.

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
### 4.1 OpenBlah as a voice client for MCP tools

- **Decided**: Purpose: let people talk by voice to MCP tools without depending on Claude's voice mode. Two audiences: (a) end users with ChatGPT, Gemini or no assistant, who use OpenBlah directly and connect their own MCP servers; (b) products that embed OpenBlah so their users get voice access to the product's MCP tools without any ChatGPT/Claude/Gemini account.
- **Recommended**: Two ways to use it, same server and agent:
  1. **Standalone**: user opens the OpenBlah app, adds MCP servers (URL), signs in to each, and talks. Works alone (1:1 Direct mode) or in a group room.
  2. **Embedded**: the host product registers its own MCP server(s) for its users. Users never see "MCP"; they tap the mic in the product.
- **Recommended**: **Connecting MCP servers.** The agent worker acts as an MCP client over Streamable HTTP (SSE fallback). Server list is per room, resolved from: host-defined servers (embedded case) plus the user's saved servers (standalone case). stdio servers are not supported (a hosted server cannot spawn local processes). **Verify** current MCP spec for transport and auth.
- **Recommended**: **Per-user auth.** Follow the MCP authorization spec (OAuth 2.1 with PKCE, dynamic client registration where the server supports it). Flow: the user taps "Connect" in the app, a browser or in-app sheet runs the server's OAuth consent, OpenBlah server stores the tokens encrypted (per user, per MCP server), refreshes them, and the agent calls tools with that user's token. Voice never carries credentials. Embedded case alternatives: (a) the host passes a short-lived user token when minting the room token (the product's own MCP server trusts it, no OAuth screen); (b) full OAuth. Option (a) is the simplest for Dani's own products. **Verify** the current MCP auth spec and which popular MCP servers support dynamic registration.
- **Recommended**: In a group room, a tool call runs with the credentials of the person who owns the connection and only when that person asked or confirmed. Other participants cannot use someone else's tools (extends the safety rule above).
- **Recommended**: **Which LLM powers the agent.** Model-agnostic design: one small `LlmProvider` interface (streaming chat with tool calls, token usage, cancel), with adapters for Claude, OpenAI and Gemini, selected per room by config. The agent's tool loop, "should I speak?" classifier and notes all use that interface, never a vendor SDK directly. MCP tool schemas are converted to each vendor's function-calling format in the adapter. STT and TTS are separate provider interfaces too. Default stays Claude. **Verify** tool-call latency and streaming-tool support of each vendor's current models; tool-calling quality in voice varies, so keep a small eval set (spoken requests → expected tool calls) and run it on every adapter.
- **Recommended**: **Who pays.** Three key modes, set per host app and per room:
  1. **Product key** (embedded default): the host product's LLM/STT/TTS keys, set in its OpenBlah server config. The product pays and may pass the cost on. Needs per-user minute caps (chunk 17).
  2. **Bring your own key (BYOK)** (standalone default): the user pastes their own Claude/OpenAI/Gemini key, stored encrypted server-side, used only for their rooms. Simple and keeps Dani from paying for strangers. STT/TTS are then also billed to the user, or fall back to a free/small default.
  3. **Self-hosted**: whoever runs the OpenBlah server pays their own providers directly (that is mode 1 for them).
  In a group room, the host's key pays for the room by default. LiveKit minutes are separate (the OpenBlah server's LiveKit project). **Open**: does Dani offer a hosted OpenBlah service with his keys at all? (Open question 17.)
- **Recommended**: Voice-first tool behaviour: tool results are summarised for speech, not read out verbatim; long results go to the screen/notes; tool names are never spoken. Slow tools get a short spoken hold ("one moment") and a visible state.
- **Recommended**: Tool discovery for large MCP servers: expose a filtered subset per room (allow-list by host) to keep prompts short and latency low.

- **Decided**: Housekeeper's current mic button is a bad voice experience; replacing it is the first real use case. **Recommended**: Do it as the first integration (chunk 13), since it is single-user and low risk, before the group features are polished.

## 5. Native apps and watch

- **Decided**: Native app is the primary experience. **Open**: Is the first OpenBlah app a standalone "OpenBlah" app or just the reference inside OpenPocket? See Open questions.
- **Recommended**: MVP client is an Expo dev-build reference app (iOS first) that exercises the package; it doubles as the demo.
- **Recommended**: Background audio and "phone in pocket": enable iOS background audio mode and the audio session category `playAndRecord` so the call survives screen lock. Bluetooth/AirPods as the normal route.
- **Verify**: iOS behaviour for mic access in background with LiveKit's RN SDK, and CallKit integration needs (CallKit makes it feel like a call and keeps the session alive, but adds complexity).
- **Decided**: Watches: Apple Watch first, and ideally other watches too (Wear OS / Android watches). Plan for both.
- **Recommended**: Which is MVP: neither watch is in the phone MVP. Apple Watch is the first watch target (chunks 14–15, right after the phone MVP). Wear OS is planned second (chunk 16) and reuses the same design: the watch is a thin audio client; all logic stays on server and phone.
- **Decided**: Apple Watch: complication (raise wrist, tap, talk). Dani has a regular Apple Watch, not an Ultra (no Action Button).
- **Verify**: Whether LiveKit's Swift SDK works on watchOS. If not:
- **Recommended fallback**: the watch records and plays audio itself and talks to the iPhone over WatchConnectivity (phone relays into LiveKit), or streams audio straight to the OpenBlah server over WebSocket, which bridges into the room as a participant. Phone relay is simpler for the first try; direct-to-server is needed for a watch without the phone nearby (cellular model).
- **Recommended**: Watch work comes after the phone MVP works. It is a spike first (chunk 14), no commitment.
- **Decided**: Android watches (Wear OS) later, after Apple Watch. **Recommended** design: a Wear OS app with a tile and complication (tap to talk), audio relayed through the paired phone (Wearable Data Layer) as first try, direct to the server over Wi‑Fi/LTE as the cellular case. **Verify** whether LiveKit's Android SDK runs on Wear OS (it is Android, so likely, but mic/audio routing and battery need checking). Samsung/Pixel watches both run Wear OS, so one app covers them; other Android-like watches (e.g. non-Wear brands) are out of scope.
- **Recommended**: Shared watch design for both platforms so the work is done once: a tiny protocol "start session / stop / mute / agent state / transcript line", carried over the phone relay or a WebSocket to the OpenBlah server.
- **Verify**: Whether a watchOS complication can launch directly into an active audio capture (watchOS limits background microphone use; the tap opens the app in the foreground). Check Apple's current rules.

## 6. Costs and free-tier limits

All numbers are to be checked on the live pricing pages before launch.

- **Verify**: LiveKit Cloud free ("Build") plan: monthly allowance of WebRTC participant minutes, concurrent participant limit, bandwidth, and agent session minutes. My memory is that it covers a modest number of minutes per month and a small number of concurrent connections; confirm exact figures and whether hosting the agent worker on LiveKit Cloud is included or the worker must be self-hosted.
- **Recommended**: A plain call with the agent off (section 2.6) costs only LiveKit minutes; AI cost starts when the agent joins. With BYOK or product keys (section 4.1) the AI cost lands on the key owner, not on OpenBlah.
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
  - One real tool path: MCP (read-only search plus one confirmed action), one OAuth-connected server, one embedded server with a host-passed token.
  - Agent optional per room: plain call, bring the agent in and out.
  - Product-key mode and one LLM adapter (Claude) behind the interface; the OpenAI adapter as proof of the interface (Gemini after).
  - Housekeeper integration replacing the mic button.
- **Recommended**: Not in the MVP: Facilitating mode tuning, watch apps (Apple Watch first, then Wear OS), Android phone app, Gemini adapter, BYOK UI, video, images, recordings, persistent standing rooms, push notifications for incoming calls, phone-number dialling, multiple languages, billing.
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
8. **Tools (MCP)**: MCP client in the agent (Streamable HTTP), webhook tools, host-passed user token, confirmation flow for write actions, action log.
9. **MCP OAuth and key modes**: per-user OAuth connect flow, encrypted token store, refresh; product-key and BYOK key storage; per-room server allow-list. Needs a test MCP server with OAuth (owner step: pick one).
10. **Model-agnostic providers**: `LlmProvider` interface hardened, OpenAI and Gemini adapters, STT/TTS interface check, tool-call eval set run on each adapter.
11. **Optional agent per room**: `off/on/ask` state, bring-in and send-out of the agent, host approval, late consent when the agent joins.
12. **React Native / Expo package and reference app**: `@openblah/react-native`, dev-build demo, background audio, Bluetooth routing. Needs the iOS device build (owner step).
13. **Housekeeper integration**: replace the mic button using the RN package and Housekeeper's MCP tools (first embedded case); collect feedback. Separate PR in the Housekeeper repo; this repo gets an integration guide.
14. **Apple Watch spike**: test LiveKit Swift SDK on watchOS; if it fails, prototype the phone-relay fallback; document findings. Owner step: Xcode and device.
15. **Apple Watch complication MVP**: raise-wrist, tap, talk on top of the spike result.
16. **Wear OS spike and app**: LiveKit Android SDK on Wear OS, tile/complication, phone relay. Owner step: a Wear OS device or emulator.
17. **Privacy and cost controls**: retention settings, delete, usage log, per-room, per-user and per-host caps, README processors list.
18. **Docs and release**: README quickstart, host integration guide (embedding with MCP tools), npm publish, demo video script, licence check.
19. **Later**: TeraPay and OpenPocket integrations, standing rooms, push-based calling, hosted service.

Chunks 1–4 give a working 1:1 voice agent early; chunk 5 de-risks the group feature before more is built on it; chunks 8–10 deliver the MCP voice-client use case.

## 11. Risks

- **Recommended**: Group-aware agent behaviour (knowing when to stay quiet) is hard and may feel wrong; mitigate with the classifier log and quick tuning loops using recorded fixtures.
- **Recommended**: Provider platforms may add the same feature soon; that is accepted by the brief. Keep the work small and swap-friendly.
- **Verify**: watchOS support and background mic limits (section 5).
- **Recommended**: Per-minute cost with many participants (section 6).
- **Recommended**: MCP voice quality: models differ in tool-calling reliability and latency; mitigate with the eval set (chunk 10). OAuth with arbitrary third-party MCP servers may be fiddly; start with servers Dani controls.
- **Recommended**: Storing users' OAuth tokens and API keys makes OpenBlah a sensitive service: encrypt at rest, minimal scopes, easy disconnect/delete.

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
15. For Apple Watch first, is a Wear OS watch available for you to test on later?
16. Should the first embedded product be Housekeeper, TeraPay or OpenPocket, and do they already have an MCP server?
17. Will you run a hosted OpenBlah with your own keys, or only bring-your-own-key and self-hosting?
18. When a product embeds OpenBlah, should the product pay for the AI, or should users pay with their own key?
19. Should a guest be able to bring the agent into a room, or only the host?
20. Which two LLMs besides Claude matter first: OpenAI, Gemini, or both?
21. For MCP sign-in, is passing the product's own user token enough for your apps, or do you also want full OAuth for other people's servers?
