# OpenBlah plan

Status tags used on every item:

- **Decided**: from Dani's brief.
- **Recommended**: my proposal, open to change.
- **Verify**: a third-party fact to check before relying on it.

## Priorities

**Decided** by Dani, in this order. Everything below (MVP scope, chunk order) follows it.

1. **Top priority: a complete voice SDK.** npm packages for web and for React Native/Expo dev builds (not Expo Go), embeddable in Dani's products and anyone else's.
2. A standalone native app people can install.
3. Swift Apple Watch client (Wear OS after it).
4. Browser join for invited guests with no install, desktop computers first.
5. Mobile browser join is low priority: nice if it works, not designed around.

## 1. What OpenBlah is

- **Decided**: An open-source (MIT) voice layer, as fluent as Claude's voice mode, for Dani's own products and anyone else's.
- **Decided**: Dani will drop it once Anthropic, OpenAI or Google catch up. The value is being useful now and showing what's possible. So: keep it small, avoid lock-in, don't over-build.
- **Decided**: Main feature is multi-person voice calls with an AI agent in the middle (Dani and Penelope, his mother, a 3–4 person business meeting).
- **Decided**: The agent listens, takes notes, facilitates, gives its opinion when asked, searches, and sends or carries out tasks with the user's own tools (e.g. booking tickets or a restaurant for the group). It knows when to stay quiet.
- **Decided**: Vision is a "walking meeting room": phone in pocket, the room with the AI always available, others can be invited mid-conversation (e.g. his mother switches from WhatsApp and joins).
- **Decided**: MVP is voice only. No video or images.
- **Decided**: The SDK comes first, then the standalone native app (phone and watch). A browser link (no install, desktop first) is the accessibility path for guests; mobile browser is low priority.
- **Decided**: The agent is optional per room. People can use OpenBlah just to talk to each other, and bring the agent in or out at any time (section 2.6).
- **Decided**: OpenBlah is also a voice client for MCP tools. Claude's voice mode works well with MCP connectors, but ChatGPT and Gemini don't. People on those assistants, or none, can talk to their MCP tools by voice through OpenBlah. Products (TeraPay, Housekeeper, OpenPocket) can embed it to give users voice access to the product's MCP tools without a ChatGPT/Claude/Gemini account (section 4).

## 2. Architecture

### 2.1 Components

- **Decided**: A standalone voice layer with its own server; npm packages for web and React Native/Expo dev builds; a Swift watch client later. Host apps (OpenPocket, Tera/TeraPay, Housekeeper) plug in.
- **Decided**: Built on LiveKit, starting on LiveKit Cloud free tier for MVP rooms.
- **Decided**: Hosting is GCP Cloud Run (all Dani's apps are on GCP). The agent worker scales to zero, with no always-on instance. The client sends a warm-up ping when the app or SDK component **opens** (before the user taps to talk) so the cold start is hidden. See 2.7.
- **Decided**: The model is a user/product setting, not a fixed choice: Gemini, OpenAI and Claude behind one interface (2.3, 4.1).
- **Recommended**: Four pieces:
  1. **LiveKit Cloud**: media (WebRTC SFU), rooms, participants.
  2. **OpenBlah server** (small TypeScript service, e.g. Hono/Node, on Cloud Run): issues LiveKit tokens, creates rooms and invites, stores room metadata, call history (transcript, summary), consent records, dispatches the agent, handles the warm-up ping. Holds all secrets.
  3. **Agent worker** (Cloud Run, scale to zero): a LiveKit Agents process that joins each room as a participant and runs the voice pipeline. **Decided**: TypeScript (Dani's stack), with an early latency spike against Python (chunk 4); switch only if TS measurably lags. Efficiency wins over language preference.
  4. **Client packages**: `@openblah/web`, `@openblah/react-native`, later a Swift package. Thin wrappers over LiveKit client SDKs plus OpenBlah's join/invite/consent API.
- **Recommended**: Monorepo (pnpm workspaces) in kupferco/openblah: `packages/server`, `packages/agent`, `packages/web`, `packages/react-native`, `apps/app` (standalone native app, Expo dev build), `apps/guest-web` (the join page, later), `docs/`. Early chunks use a tiny dev test page inside `packages/web`, not the polished guest page.
- **Verify**: LiveKit Agents' current JS/TS SDK maturity versus Python. **Decided** rule: measure it in the chunk 4 spike (end-of-speech to first audio, turn detection quality, feature gaps). If TS measurably lags, use Python for the worker only; the packages stay TS.
- **Verify**: Cloud Run long-lived WebSocket/worker behaviour on scale-to-zero: a LiveKit Agents worker registers with LiveKit and waits for jobs, which conflicts with zero instances. **Recommended** fix: the server dispatches on demand (warm-up ping or room start triggers a Cloud Run instance, with min-instances 0). Check Cloud Run request timeout (up to 60 min) against call length, and CPU-always-allocated settings.

### 2.2 Rooms

- **Recommended**: One LiveKit room per conversation. Room name is a random ID. Room persists as long as someone is in it; a "standing room" per user (the "always available" room) is a saved record in the OpenBlah server that creates the LiveKit room on demand.
- **Recommended**: The agent joins only when the room's agent state is `on` (section 2.6) and leaves when the last human leaves (no cost when empty).
- **Decided**: The user taps to start talking. There is no wake word in the MVP (Roadmap).
- **Recommended**: Room metadata (host, host app, participants' display names, agent persona, tool set, consent state) lives in the OpenBlah server DB, mirrored to LiveKit room metadata for clients.
- **Recommended**: Mid-call invites: host taps "Invite", the server mints a link; the guest joins the same room. Nobody has to restart the call.

### 2.3 Voice pipeline

- **Recommended**: Start with the cascaded pipeline (STT → LLM → TTS) via LiveKit Agents, because group calls need per-speaker transcripts, a text channel for tools and notes, and model choice. Speech-to-speech models (OpenAI Realtime, Gemini Live) handle multiple speakers poorly and hide the transcript.
- **Recommended**: Defaults to try first, behind a provider interface so they are swappable:
  - **STT**: Deepgram streaming (fast, diarization-friendly), alternative AssemblyAI, OpenAI or Google. **Verify** English and Portuguese (pt-BR) quality and language auto-detect.
  - **LLM**: **Decided**: user/product setting across Gemini, OpenAI and Claude behind one interface. **Decided** default out of the box: Gemini Flash (fast, cheap, free API tier). See 4.1 for keys and data terms.
  - **TTS**: Cartesia or ElevenLabs (low latency, natural), alternative OpenAI or Google TTS. **Verify** natural pt-BR voices.
- **Decided**: Languages first: English and Portuguese. The agent answers in the language people speak (follows each turn; in a mixed room it replies in the language of whoever asked). **Recommended**: language is detected per participant track, with a per-room override.
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
- **Recommended**: Speak only when: (a) addressed by name (the agent name is undecided, see Open questions; products may name their own; the name is configurable per room), (b) asked by a person in the last turn for an opinion, (c) in Facilitating mode and a rule fires (decision reached, long silence after a question, time check requested).
- **Recommended**: Decision is made by a cheap, fast "should I speak?" classifier call on each finished turn (small model, outputs speak/stay-quiet + reason), separate from the main LLM. Logged for tuning.
- **Recommended**: Replies are short by default (1–3 sentences), longer only if asked.
- **Recommended**: Addressing is by name plus context: if Dani says "<agent name>, what do you think?" the agent answers; if he says "Penelope, what do you think?" it stays quiet. Eye-contact style cues don't exist, so name use is the main signal; the classifier uses recent turns.
- **Recommended**: Visible state on every client (listening / thinking / speaking / muted) so people trust it. A "mute the agent" control for everyone.

### 2.6 Group calls and the optional agent

- **Decided**: 2–3+ people can talk in one room with the AI agent in the middle if they want. The agent is optional per room: a room can be a plain voice call between people, and the agent can be brought in or sent out at any time.
- **Recommended**: A room has an `agent` state: `off` (plain call), `on` (agent present, in Listening/Facilitating/Direct mode). **Decided**: by default only the host can bring the agent in; a room setting ("anyone can add the agent") lets any participant do it. Non-host requests go to the host as an approval prompt unless that setting is on. Voice requests work only when the agent is already present.
- **Recommended**: Agent worker is dispatched only when the state flips to `on`, and leaves when it flips to `off`. In `off` state no audio goes to STT/LLM/TTS, so a plain call costs only LiveKit minutes and no AI processing happens. Consent (section 7) is asked when the agent first joins, not only at room start, so people who joined an AI-free room agree before it starts listening.
- **Recommended**: Rooms are created with `agent: on | off | ask` by the host app; default `ask` (agent off until someone invites it). **Decided**: calls work fully with the agent off.
- **Recommended**: Group size target: 2–4 humans in the MVP; "3+" beyond that is not tuned. **Verify** LiveKit limits per room on the free plan.

### 2.7 Cold start and warm-up

- **Decided**: The client app/SDK sends a warm-up ping to the OpenBlah server when it **opens**, before the user taps to talk, so the scale-to-zero agent worker is already starting. No always-on instance.
- **Recommended**: `POST /v1/warmup` (authenticated, cheap, idempotent, rate-limited). The server starts or wakes the agent worker and returns immediately. Ping again when the app returns to the foreground. If the worker is still cold when the user taps, the client shows "connecting" and the call works as a plain room until the agent arrives.
- **Verify**: Cloud Run cold start time for the Node worker image (target under ~3 s; keep the image small). Measure it in chunk 4.
- **Recommended**: Warm-up must not cost AI money: it starts the process only, with no STT/LLM/TTS calls.

## 3. Identity and invites

- **Recommended**: Two participant types:
  - **App users**: authenticated via the host app. The host app's backend calls the OpenBlah server (server-to-server, API key) to mint a short-lived join token for its user. For embedded products OpenBlah runs no accounts of its own; it trusts the host app's user ID and display name. The standalone app has its own sign-in (Open question 6), needed for the trial, keys and history.
  - **Browser guests**: no account. Join through an invite link containing a single-use or limited-use invite token; they enter a display name and consent, then join.
- **Decided**: Invite links use `openblah.web.app` (Firebase Hosting) for now, a custom domain later (Roadmap).
- **Recommended**: Invite link format `https://openblah.web.app/j/<token>`. Token is random, expires (default 24 h), tied to one room, revocable by the host. Opens the native app if installed (universal link), else the web page. This also covers the mother case: send the link on WhatsApp, she taps, it opens in the browser.
- **Recommended**: Guests are labelled "guest" in the room and have fewer rights: can't invoke tools on the host's accounts, can't change agent mode, can't see other participants' contact details.
- **Recommended**: Host controls: invite, remove participant, end room, set agent mode, approve tool actions.
- **Verify**: Universal links / App Links need an HTTPS domain and apple-app-site-association file; needs Dani's Apple developer account (see section 9). Until it exists, invites open the web page; universal links come later.
- **Recommended**: The "invite mid-conversation" voice command: "<agent name>, invite my mother". The agent asks the host app for the contact (via a tool), and sends the link through a configured channel (SMS/share sheet); at first the share sheet is enough.

## 4. How host apps plug in

- **Recommended**: Packages:
  - `@openblah/server`: runnable server, also embeddable as a library.
  - `@openblah/web`: React hooks and a ready component (`<OpenBlahRoom />`), vanilla JS core.
  - `@openblah/react-native`: same API for Expo dev builds (needs native modules via `@livekit/react-native`, so Expo Go won't work). **Verify** the current LiveKit RN + Expo config plugin setup.
  - Swift package later for the watch.
- **Recommended**: Host app integration in three steps: (1) backend calls `POST /v1/rooms` and `POST /v1/tokens` with its OpenBlah API key; (2) client mounts the component with the token; (3) host registers tools.
- **Decided**: Agent actions come from connected MCP tools (e.g. Housekeeper, TeraPay). There is no built-in booking tool (bookings are Roadmap).
- **Recommended**: Agent tools come from the host app in two ways:
  1. **MCP servers**: the host lists MCP server URLs (plus per-user auth) on room creation; the agent connects as an MCP client. Matches "carries out tasks with the user's own tools".
  2. **Webhook tools**: simple JSON-schema tool definitions with a callback URL, for apps that don't run MCP.
- **Decided**: First embedded products: Housekeeper and TeraPay, both already have MCP servers. OpenPocket later.
- **Decided**: SDK distribution: publish on npm as 0.x early, before Housekeeper uses it (chunk 13 precedes chunk 14).
- **Recommended**: Tool safety: read-only tools (search, lookup) run freely. Tools that change anything (book, send, pay) require spoken or tapped confirmation from the host before running, with the agent reading back what it will do ("Book a table for four at 19:30 at X, OK?"). In a group, confirmation comes from the owner of the tool credentials, not any participant.
- **Recommended**: Agent built-ins: notes, summary, action list, web search (via a search tool/MCP), and the invite command.

### 4.1 OpenBlah as a voice client for MCP tools

- **Decided**: Positioning: OpenBlah is an alternative to Claude/ChatGPT voice for using MCP tools, especially with several people in the room. Claude voice mode as a live participant in OpenBlah rooms is not feasible and not planned.
- **Decided**: Purpose: let people talk by voice to MCP tools without depending on Claude's voice mode. Two audiences: (a) end users with ChatGPT, Gemini or no assistant, who use OpenBlah directly and connect their own MCP servers; (b) products that embed OpenBlah so their users get voice access to the product's MCP tools without any ChatGPT/Claude/Gemini account.
- **Recommended**: Two ways to use it, same server and agent:
  1. **Standalone**: user opens the OpenBlah app, adds MCP servers (URL), signs in to each, and talks. Works alone (1:1 Direct mode) or in a group room.
  2. **Embedded**: the host product registers its own MCP server(s) for its users. Users never see "MCP"; they tap the mic in the product.
- **Recommended**: **Connecting MCP servers.** The agent worker acts as an MCP client over Streamable HTTP (SSE fallback). Server list is per room, resolved from: host-defined servers (embedded case) plus the user's saved servers (standalone case). stdio servers are not supported (a hosted server cannot spawn local processes). **Verify** current MCP spec for transport and auth.
- **Recommended**: **Per-user auth.** Follow the MCP authorization spec (OAuth 2.1 with PKCE, dynamic client registration where the server supports it). Flow: the user taps "Connect" in the app, a browser or in-app sheet runs the server's OAuth consent, OpenBlah server stores the tokens encrypted (per user, per MCP server), refreshes them, and the agent calls tools with that user's token. Voice never carries credentials. **Decided**: support both. (a) Embedded products pass their logged-in user's token when minting the room token (the product's own MCP server trusts it, no OAuth screen); simplest for Housekeeper and TeraPay. (b) The standalone app supports full OAuth sign-in to any MCP server, like Claude connectors. **Verify** the current MCP auth spec and which popular MCP servers support dynamic registration.
- **Recommended**: In a group room, a tool call runs with the credentials of the person who owns the connection and only when that person asked or confirmed. Other participants cannot use someone else's tools (extends the safety rule above).
- **Recommended**: **Which LLM powers the agent.** Model-agnostic design: one small `LlmProvider` interface (streaming chat with tool calls, token usage, cancel), with adapters for Claude, OpenAI and Gemini, selected per room by config. The agent's tool loop, "should I speak?" classifier and notes all use that interface, never a vendor SDK directly. MCP tool schemas are converted to each vendor's function-calling format in the adapter. STT and TTS are separate provider interfaces too. **Decided** default: Gemini Flash. The model is a setting at three levels, in this order of precedence: room, user/product, server default. It is configurable through settings screens, onboarding (first run asks which provider and key), **and MCP tools** (a settings MCP tool so the agent or another client can read and change the model by voice or text, with the confirmation rule for changes). **Verify** tool-call latency and streaming-tool support of each vendor's current models; tool-calling quality in voice varies, so keep a small eval set (spoken requests → expected tool calls) and run it on every adapter.
- **Decided**: **Who pays.** Consumer subscriptions (ChatGPT Plus, Gemini app, Claude app) cannot power another app; API keys are required. Key modes:
  1. **Product key** (embedded): **Decided**: the embedding product pays with the product's key; its users never see keys. Needs per-user minute caps (chunk 15).
  2. **Bring your own key (BYOK)** (standalone): **Decided**: users bring their own key, stored encrypted server-side and used only for their rooms. A free Gemini key is easy to get and is the suggested first step in onboarding.
  3. **Trial on OpenBlah's key**: **Decided**: OpenBlah's hosted key is only for demos and trials. A new user gets about a 5-minute trial conversation, then adds their own key. **Recommended**: enforce server-side by seconds of agent audio, tied to the account (see Open question 2), counted against the £50 testing budget (section 6).
  4. **Self-hosted**: whoever runs the OpenBlah server pays their own providers directly (same as mode 1 for them).
  In a group room, the host's key pays by default. LiveKit minutes are separate (the OpenBlah server's LiveKit project).
- **Decided**: Free-tier Gemini data may be used by Google (including for training). Private data (e.g. TeraPay patients) must use paid tiers, never the free key. **Recommended**: embedded products flag a room `sensitive`; the server then refuses keys marked free-tier and shows the data terms. See Open question 5.
- **Recommended**: Voice-first tool behaviour: tool results are summarised for speech, not read out verbatim; long results go to the screen/notes; tool names are never spoken. Slow tools get a short spoken hold ("one moment") and a visible state.
- **Recommended**: Tool discovery for large MCP servers: expose a filtered subset per room (allow-list by host) to keep prompts short and latency low.

- **Decided**: Housekeeper's current mic button is a bad voice experience; replacing it is the first real use case. **Recommended**: Do it as the first integration (chunk 14), right after the 0.x SDK is published, since it is single-user and low risk and proves the SDK in a real product. TeraPay follows (Roadmap, privacy rules above apply).

## 5. Native apps and watch

- **Decided**: Native app is the primary experience. The first native app is a standalone OpenBlah app (not a demo inside OpenPocket).
- **Decided**: Until the Apple developer account exists (around December 2026), the web SDK and the browser guest page go first (section 9). Users are in the UK and Brazil (Dani is in London, moving to São Paulo): **Verify** LiveKit Cloud region choice and latency for both (Europe and South America).
- **Recommended**: The SDK ships first with a small Expo dev-build example app that exercises it (chunk 5). The standalone installable app (chunk 16, priority 2) is built on the SDK as its first consumer, with no private APIs, so what the app can do, any product can do.
- **Recommended**: Background audio and "phone in pocket": enable iOS background audio mode and the audio session category `playAndRecord` so the call survives screen lock. Bluetooth/AirPods as the normal route.
- **Verify**: iOS behaviour for mic access in background with LiveKit's RN SDK, and CallKit integration needs (CallKit makes it feel like a call and keeps the session alive, but adds complexity).
- **Decided**: Watches: Apple Watch first, and ideally other watches too (Wear OS / Android watches). Plan for both.
- **Decided**: MVP watch is Apple Watch only. Wear OS and other watches are Roadmap (Dani has no Wear OS device). Apple Watch comes after the SDK and the standalone app (chunks 17–18). The design stays reusable: the watch is a thin audio client; all logic stays on the server.
- **Decided**: The watch app always talks to the cloud itself; watchOS routes the connection via the iPhone, Wi-Fi or cellular. It works with or without the phone nearby, as long as the watch has a connection. This removes the phone-relay-only fallback as a final design.
- **Decided**: Apple Watch: complication (raise wrist, tap, talk). Dani has a regular Apple Watch, not an Ultra (no Action Button).
- **Verify**: Whether LiveKit's Swift SDK works on watchOS. If not:
- **Recommended fallback**: the watch records and plays audio itself and streams it straight to the OpenBlah server over WebSocket, which bridges into the room as a participant (needs no phone, matching the Decided rule above). Only if even that fails, a WatchConnectivity relay through the iPhone for the phone-nearby case.
- **Recommended**: Watch work comes after the phone MVP works. It is a spike first (chunk 17), no commitment.
- **Decided (Roadmap)**: Wear OS (Samsung/Pixel) later, no test device yet. **Recommended** design when it happens: a tile and complication (tap to talk), direct to the server over Wi‑Fi/LTE. **Verify** whether LiveKit's Android SDK runs on Wear OS.
- **Recommended**: Tiny watch protocol "start session / stop / mute / agent state / transcript line", over WebSocket to the OpenBlah server, reusable for Wear OS later.
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
- **Decided**: Testing budget for provider fees (LLM, STT, TTS, trials; LiveKit stays on the free tier): £50 per month maximum.
- **Recommended**: Enforce it: a GCP billing budget with alerts at 50%, 80% and 100% (£25 / £40 / £50) on the project; provider-side spend limits where offered (OpenAI, Deepgram, ElevenLabs and Google AI Studio/Cloud quotas); an in-server monthly provider-cost counter that stops the trial key and demo rooms at £50 (hard cap) and notifies Dani at 80%. The Gemini free tier is the default so most development costs nothing. Owner step: set the billing budget and provider limits (chunk 15).
- **Decided**: Start on LiveKit Cloud free tier.
- **Decided**: Hosting is GCP Cloud Run for the server and agent worker, scale to zero (section 2.7). Cloud Run bills per request-second while an instance is up, so idle cost is about zero. **Verify** the Cloud Run free tier covers a worker's CPU during a call.

## 7. Privacy

- **Recommended**: Principle: nothing is recorded or stored without everyone in the room knowing.
- **Recommended**: Consent flow:
  - Every participant (app and guest) sees, before joining, a plain line: "An AI listens to this call and takes notes. Audio is not saved. Transcript and summary are saved in the call history for everyone in the call."; they must tap to join. Shown only when the agent is on, or when it is first brought in.
  - The agent says on entry, "<agent name> is here and listening," and again when someone joins.
  - Anyone can ask the agent to stop listening, or leave; a "pause AI" control mutes the agent's listening for everyone with a visible indicator.
- **Recommended**: Defaults: **no audio recording**. Audio is streamed to STT and discarded. Transcript kept in memory during the call; notes and summary saved only if the host turns "save notes" on.
- **Decided**: No notes are sent to anyone (no email, no push). Each call or room keeps its transcript and summary in the app's history, and participants open them there. **Recommended**: History is visible only to people who were in that call; app users see it in the app, guests per Open question 3.
- **Recommended**: Transcript and summary live in history, so retention matters: configurable retention and a delete button for the host (default is Open question 4). Audio is never kept.
- **Recommended**: Third-party processors (LiveKit, STT, LLM, TTS) see audio/text in transit. List them in the README and the consent text. Prefer providers with a no-training/zero-retention option. **Verify** each provider's data retention and training terms.
- **Recommended**: Legal note (not legal advice): recording and transcription consent laws differ by country and some require all-party consent. All-party consent at join, as above, is the safe design. **Decided**: Dani is in London (moving to São Paulo) and users are in the UK and Brazil, so UK GDPR and Brazil's LGPD apply: data minimisation, deletion, a processors list, and a lawful basis for transcripts. **Verify** each provider's data location and transfer terms.
- **Decided**: Free-tier Gemini data may be used by Google, so it is never used for private data (patients, billing); see section 4.1.
- **Recommended**: If a participant declines the AI, the host can leave AI off; the room still works as a normal call (**Decided**, section 2.6).
- **Recommended**: Tool actions are logged (who asked, what ran) for the host to review.

## 8. MVP scope

- **Decided**: Voice only. The SDK (web + React Native) is the MVP; the standalone app and browser guest page follow in priority order.
- **Recommended**: In the MVP:
  - Published `@openblah/web` and `@openblah/react-native` packages with hooks, a ready component, and docs: create a room, join from an iOS dev build (via the SDK example app), invite someone by link, they join with the web package (on a minimal test page; the polished guest page is not MVP).
  - Tap to start (no wake word). English and Portuguese. Warm-up ping on app open.
  - Agent with Listening / Direct modes, addressed by name, interruption handling, "should I speak?" classifier.
  - Notes and a post-call summary.
  - Consent screen and visible agent state.
  - One real tool path: MCP (read-only search plus one confirmed action), one OAuth-connected server, one embedded server with a host-passed token (Housekeeper's MCP server first).
  - Call history with transcript and summary in the app (no sending).
  - Agent optional per room: plain call, bring the agent in and out.
  - Model as a setting behind one interface: Gemini Flash default, plus OpenAI and Claude adapters; product-key mode and BYOK (key setting in onboarding and settings, plus the MCP settings tool); 5-minute trial on OpenBlah's key.
  - Cost caps and alerts within £50/month.
  - Housekeeper integration replacing the mic button (just after the MVP SDK release).
- **Recommended**: Not in the MVP: standalone installable app (priority 2), polished guest page (priority 4), mobile-browser polish (priority 5), Facilitating mode tuning, watch apps (Apple Watch is the first watch target after the MVP; Wear OS is Roadmap), Android phone app, wake word, built-in booking, OpenBlah's own MCP server, video, images, recordings, persistent standing rooms, push notifications for incoming calls, phone-number dialling, languages beyond English and Portuguese, billing.
- **Recommended**: Success test for the MVP: Dani and Penelope have a 10-minute call with the agent in the room, the agent stays silent while they talk to each other, answers when asked, and produces correct notes.

## 9. Apple developer account

- **Decided**: Dani is moving apps toward the App Store and will get his own Apple developer account, around December 2026. Until then, the web SDK and the browser guest page go first.
- **Recommended**: Consequence for order: chunks that do not need Apple (1–4, 6–13, 15, 20) run before the account exists. Chunks needing it (5 on a device beyond free provisioning, 16 TestFlight, 17–18 watch, universal links) are scheduled after December 2026. Chunk 20 (guest page, a priority-4 item) may be pulled forward ahead of chunk 5 while the account is missing, as it gives the web SDK a real UI to test with.
- **Recommended**: Until then, use the free-provisioning dev build on his own device for testing (limited: 7-day signing, no push, no associated domains). The paid account is needed for TestFlight, universal links and background modes in practice. Chunks that need it are marked below.
- **Verify**: Which capabilities (Associated Domains, background audio) work with a free account.

## 10. Implementation chunks

Each is sized as one Viber task (a few hours of coding session, one PR, testable). Order matters and follows the Priorities section: SDK first (chunks 1–15), then the standalone app, watch, browser guest page, mobile browser.

**Priority 1: the voice SDK**

1. **Repo scaffold**: pnpm monorepo, TypeScript config, lint, test setup, CI, empty packages, `.env.example`. No LiveKit yet.
2. **Server core**: token endpoint, room create/get, API key auth, health check, tests; LiveKit server SDK. Needs a LiveKit Cloud project (owner step: create project and set secrets). Deploy target is Cloud Run.
3. **`@openblah/web` SDK core**: vanilla JS core plus React hooks (`useRoom`, `useParticipants`, `useAgentState`, mute), joining a room with a token. A minimal dev test page in the package (not the guest page). Two browser tabs can talk.
4. **Single-user agent**: agent worker (TypeScript) joins a room, STT → LLM → TTS with Direct mode, tap to start, barge-in and turn detection. Provider interfaces with Gemini Flash default. Warm-up endpoint and Cloud Run scale-to-zero deploy. **Includes the latency spike**: the same pipeline in Python for comparison, measuring end-of-speech to first audio and cold start; stay on TypeScript unless it measurably lags. English and Portuguese test. Owner step: API keys, GCP project.
5. **`@openblah/react-native` SDK and Expo example app**: same API as the web package, Expo dev build (not Expo Go) with config plugin, background audio, Bluetooth routing. Needs the iOS device build (owner step).
6. **Spike: multi-participant agent**: per-participant STT streams, speaker-tagged transcript, "should I speak?" classifier. Offline-testable with recorded audio fixtures. Answers the main Verify in 2.3.
7. **Group behaviour**: Listening / Facilitating / Direct modes, name addressing, mute-agent control, notes and summary generated at the end.
8. **Invites and consent**: invite tokens, expiry and revoke, consent API and agent announcement, guest rights, host controls, exposed in both SDKs.
9. **Tools (MCP)**: MCP client in the agent (Streamable HTTP), webhook tools, host-passed user token, confirmation flow for write actions, action log.
10. **MCP OAuth and key modes**: per-user OAuth connect flow, encrypted token store, refresh; product-key and BYOK key storage; 5-minute trial on OpenBlah's key; free-tier key refusal for `sensitive` rooms; per-room server allow-list. Needs a test MCP server with OAuth (owner step: pick one).
11. **Model-agnostic providers**: `LlmProvider` interface hardened, Gemini (default), OpenAI and Claude adapters, STT/TTS interface check, tool-call eval set run on each adapter (English and Portuguese). Model setting via config, onboarding hook and an MCP settings tool.
12. **Optional agent per room**: `off/on/ask` state, bring-in and send-out of the agent, host-only by default with a room setting to let anyone, late consent when the agent joins.
13. **SDK completion and release**: API stability pass across both packages, ready components, API reference, quickstart and host integration guide (embedding with MCP tools), example apps, npm publish 0.x (early, before Housekeeper uses it), licence check.
14. **Housekeeper integration**: replace the mic button using the RN package and Housekeeper's MCP tools (first embedded case, validates the SDK; TeraPay follows later); collect feedback. Separate PR in the Housekeeper repo; this repo gets an integration guide.
15. **Privacy and cost controls**: call history screen data, retention settings, delete, usage log, per-room, per-user and per-host caps, £50/month provider cost cap with alerts (owner step: GCP billing budget and provider limits), README processors list.

**Priority 2: standalone native app**

16. **Standalone OpenBlah app**: installable Expo dev-build app on the SDK only: sign-in, onboarding (choose model, add own key, start the 5-minute trial), settings, create room, invite by link, call with or without the agent, connect MCP servers (full OAuth), call history with transcripts and summaries. TestFlight needs the Apple developer account (owner step).

**Priority 3: watches**

17. **Apple Watch spike**: test LiveKit Swift SDK on watchOS; if it fails, prototype the phone-relay fallback; document findings. Owner step: Xcode and device.
18. **Apple Watch complication MVP**: raise-wrist, tap, talk on top of the spike result; the watch talks to the cloud itself, with or without the phone nearby.
19. **Roadmap, not scheduled: Wear OS spike and app**: LiveKit Android SDK on Wear OS, tile/complication. Waits for a Wear OS device.

**Priority 4 and 5: browser join**

20. **Guest web page**: `apps/guest-web`, invite link opens in a desktop browser with name entry, consent, mic check, mute, participants and agent state, built on `@openblah/web`. Desktop Chrome, Safari and Firefox first.
21. **Mobile browser join (low priority)**: make the guest page work on mobile Safari and Chrome where cheap (audio unlock, background limits). No redesign; accept limits.
22. **Later**: TeraPay integration (paid-tier keys only), OpenPocket, OpenBlah's own MCP server, wake word, booking tools, custom domain; see the Roadmap section.

Chunks 1–4 give a working 1:1 voice agent early; chunk 5 puts it on the phone through the SDK; chunk 6 de-risks the group feature before more is built on it; chunks 9–11 deliver the MCP voice-client use case; chunk 13 is the complete SDK release.

## 11. Risks

- **Recommended**: Group-aware agent behaviour (knowing when to stay quiet) is hard and may feel wrong; mitigate with the classifier log and quick tuning loops using recorded fixtures.
- **Recommended**: Provider platforms may add the same feature soon; that is accepted by the brief. Keep the work small and swap-friendly.
- **Verify**: watchOS support and background mic limits (section 5).
- **Recommended**: Per-minute cost with many participants (section 6) and the £50/month cap.
- **Recommended**: Abuse of the free trial key (endless new accounts): tie to sign-in, cap globally.
- **Recommended**: Scale-to-zero cold start hurts the first tap if the warm-up ping is late (section 2.7).
- **Recommended**: MCP voice quality: models differ in tool-calling reliability and latency; mitigate with the eval set (chunk 11). OAuth with arbitrary third-party MCP servers may be fiddly; start with servers Dani controls.
- **Recommended**: Storing users' OAuth tokens and API keys makes OpenBlah a sensitive service: encrypt at rest, minimal scopes, easy disconnect/delete.

## Roadmap (deferred, not in the MVP)

All **Decided** by Dani as "later", unless marked.

- Wake word ("hey ..."): the MVP is tap-to-start. Wake word comes later, once the agent has a name.
- Wear OS and other watches (Dani has no Wear OS device to test on). Chunk 19.
- Booking tools built into OpenBlah. Bookings come only from connected MCP tools for now (Housekeeper, TeraPay).
- OpenBlah's own MCP server: lets Claude or any MCP client read past rooms, transcripts and decisions ("what did we decide in yesterday's OpenBlah call?"). **Recommended** shape: read-only, OAuth per user, same privacy rules as the history screen.
- Custom domain for invite links (now `openblah.web.app`).
- Standing rooms, push-based calling, hosted service beyond demos, release 1.0 and demo video, TeraPay and OpenPocket deeper integrations.
- **Decided: not planned / not feasible**: Claude voice mode as a live participant in OpenBlah rooms. OpenBlah is an alternative to it, not a plug-in for it.

## Open questions

Only what Dani has not yet answered. Everything else is Decided above.

1. What should the agent be called? (Decided: later; products may name their own. Needed before wake word work and the consent text wording.)
2. The 5-minute trial on OpenBlah's key: must a user sign in first (to stop one person getting endless trials), and is one trial per account/device fine?
3. Guests have no account: how do they open their call's transcript and summary afterwards? Option: the invite link stays valid for read-only history for 30 days; or guests must sign up to keep it. Which?
4. How long should call history (transcript and summary) be kept by default: 30 days, a year, or until deleted?
5. For TeraPay (patient data): is a paid Gemini/other tier with a no-training agreement enough, or must the agent run on a provider with a signed data processing agreement (and for Brazil, LGPD)?
6. How do users of the standalone app sign in to OpenBlah itself: email link, Apple/Google sign-in, or both?
