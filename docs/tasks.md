# OpenBlah implementation task breakdown

## Overview

This turns `docs/plan.md` (section 10 chunks, plus the decisions in sections 2–9 and the Roadmap) into 30 ordered Viber tasks, T1 to T30. Priority follows the plan: the voice SDK first (T1–T23), then the standalone app (T24–T26), the Apple Watch (T27–T28), the desktop guest page (T29) and mobile browser join (T30). The plan's chunks were split where one chunk is bigger than one coding session (agent, tools, keys, invites, SDK release, standalone app, watch). Plan decisions are kept as written. Roadmap items (Wear OS, wake word, booking tools, OpenBlah's own MCP server, custom domain, TeraPay and OpenPocket integrations, standing rooms) are **not** tasks.

**Total: 30 tasks.**

### Dependency conventions

- `after_live` (default): wait until the dependency is merged and live. Used whenever the task builds on that code.
- `after_ready`: only wait for the dependency's preview to be ready. Used only for spikes and for steps that need a running result, not merged code.
- Every brief ends with "done looks like"; every task runs the repo checks (typecheck, tests, build) and updates docs it touches.
- "Dani: manual steps" are things no coding session can do. Where a script needs them, it prints the `::viber-manual::` marker described in CLAUDE.md.

### Dependency graph

```
T1 ── T2 ─┬─ T3 ──────────────┬─ T7 (also needs T2)
          │                   └─ T11 (needs T3, T7, T10, T4)
          ├─ T10 ─┬─ T11
          │       ├─ T18 (also T9)
          │       └─ T19 (also T9)
          ├─ T4 ──┬─ T5 ── T20 (also T14)
          │       ├─ T6   (spike, after_ready)
          │       ├─ T8 ── T9 ── T18, T19
          │       ├─ T12 ─┬─ T13
          │       │       ├─ T15 (also T14)
          │       │       └─ T16 ── T17 (also T14)
          │       └─ T14 (also T2) ── T15, T17, T20
T3,T7,T11,T13,T17,T18,T19 ── T21 ── T22 (also T20) ─┬─ T23
                                                    └─ T24 ─┬─ T25 (also T15, T19)
                                                            ├─ T26
                                                            └─ T27 ── T28
T11 (+T3) ── T29 ── T30
```

Parallel groups, once their dependencies are live:

- After T2: **T3, T4, T10** in parallel.
- After T4: **T5, T6, T8, T12, T14** in parallel (T14 also needs T2).
- After T3 (and T2): **T7** in parallel with the T4 branch of work.
- After T12: **T13, T16** in parallel; T15 once T14 is also done.
- After T9 and T10: **T18, T19** in parallel.
- **T29 (guest page)** needs only T11 (and T3), so it can run beside the whole agent and tools branch, and be pulled forward while no Apple account exists (plan section 9).
- After T22: **T23 and T24** in parallel. After T24: **T25, T26, T27** in parallel (T27 and T28 need the Apple account).

## Open questions and the tasks they affect

Only unanswered questions from the plan. Each affected task names its assumed default so it can proceed; if Dani answers differently, adjust the later task briefs or send a follow-up.

| #   | Plan question                                             | Affects                                                       | Assumed default                                                                                                                                                                             |
| --- | --------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Agent name                                                | T9, T11, T24 (and wake word, which is Roadmap)                | Configurable `agentName`, per room, default "Blah". Used in addressing, consent text and announcements; never hard-coded.                                                                   |
| Q2  | 5-minute trial: sign-in required? one per account/device? | T14, T24                                                      | Sign-in required. One trial of 300 s of agent audio per account, plus a best-effort per-device limit and a global cap.                                                                      |
| Q3  | How guests open history after the call                    | T19, T29                                                      | The invite link stays valid for read-only history for 30 days (no sign-up). Easy to change to "guests must sign up" because it is one policy function.                                      |
| Q4  | Default history retention                                 | T19                                                           | 30 days, host-configurable (30 days / 1 year / until deleted), host can delete any time.                                                                                                    |
| Q5  | TeraPay: is a paid tier enough or is a signed DPA needed? | T14 (sensitive rooms) and the unscheduled TeraPay integration | `sensitive` rooms refuse free-tier keys and require the key owner to confirm "paid tier, no training". No DPA enforcement in code. The TeraPay integration is not scheduled until answered. |
| Q6  | Standalone app sign-in method                             | T14, T24, T26                                                 | Firebase Auth (fits GCP and Firebase Hosting) with email link and Google. Sign in with Apple is added in T26, since the App Store requires it when other third-party sign-in is offered.    |

---

## T1: Repo scaffold

- **depends_on**: none
- **Plan**: section 2.1 (monorepo), chunk 1.

**Brief**

Create the pnpm workspaces monorepo for OpenBlah (MIT, repo kupferco/openblah). Layout: `packages/server`, `packages/agent`, `packages/web`, `packages/react-native`, `apps/app`, `apps/guest-web`, `docs/` (keep `docs/plan.md` and `docs/tasks.md`). Add: root `tsconfig` base with strict TypeScript, ESLint and Prettier, Vitest as the test runner, a `.env.example` listing the future variables (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENBLAH_API_KEYS, GEMINI_API_KEY, DEEPGRAM_API_KEY, CARTESIA_API_KEY) with comments, root scripts `typecheck`, `lint`, `test`, `build`, and a GitHub Actions CI workflow that runs them on pull requests (keep the existing `.github/workflows/viber.yml` untouched). Each package gets a name under the `@openblah/` scope (`apps/*` stay private), a `src/index.ts` with a trivial exported function and one passing test. Expand the README with a project summary, the repo layout and the commands. No LiveKit code yet.

**Done looks like**: `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass locally and in CI; every package builds.

**Dani: manual steps**: none.

---

## T2: Server core

- **depends_on**: T1
- **Plan**: section 2.1 piece 2, section 2.2, section 4 host steps 1–2, chunk 2.

**Brief**

Build `packages/server` as a small TypeScript service (Hono on Node) deployable to Cloud Run. Endpoints: `GET /health`; `POST /v1/rooms` (create a room: random room ID, host user ID and display name, optional `agent: on|off|ask` default `ask`, optional `sensitive` flag, optional metadata); `GET /v1/rooms/:id`; `POST /v1/tokens` (mint a short-lived LiveKit join token for a user ID and display name in a room). Auth: server-to-server API key from the `OPENBLAH_API_KEYS` env var (`Authorization: Bearer`), constant-time compare. Use the LiveKit server SDK (`livekit-server-sdk`) and keep a storage interface with an in-memory implementation plus a Firestore implementation chosen by env (the DB for later room metadata, invites, history). Mirror room metadata to LiveKit room metadata. Add a Dockerfile (small image) and a `docs/deploy.md` with the Cloud Run deploy commands. Unit and integration tests with a mocked LiveKit client. Never log secrets.

**Done looks like**: tests cover auth failure, room create/get, token mint; `docker build` works; the server runs locally with `.env`.

**Dani: manual steps**

- Create a LiveKit Cloud project (free tier) and choose a region (Europe is a good start; check South America latency later). Copy URL, API key and secret.
- Add them as repo/Cloud Run secrets (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) and create an `OPENBLAH_API_KEYS` value.
- If deploying: a GCP project with Cloud Run and Firestore enabled (the actual deploy is wired up in T5).

---

## T3: `@openblah/web` SDK core

- **depends_on**: T2
- **Plan**: section 4 packages, chunk 3.

**Brief**

Build `packages/web`: a vanilla JS core wrapping `livekit-client` plus React hooks. API: `OpenBlahClient` (connect with a token and server URL, disconnect, mute/unmute, events), React hooks `useRoom`, `useParticipants`, `useAgentState` (listening / thinking / speaking / muted, read from the agent participant's attributes, stubbed until the agent exists) and `useMute`. Add a minimal dev test page in the package (Vite, not the guest page) with a token field and join button so two browser tabs can talk. Include unit tests with a mocked LiveKit client and a short `README` for the package. Keep the public API small and documented with TSDoc; mark it 0.x unstable.

**Done looks like**: two tabs joined with tokens from the T2 server hear each other (describe the manual check in the PR); tests, typecheck and build pass.

**Dani: manual steps**: none (uses the T2 LiveKit project; the reviewer needs a token from the T2 server).

---

## T4: Single-user agent worker

- **depends_on**: T2
- **Plan**: sections 2.1 piece 3, 2.3, 2.4, chunk 4 (first part).

**Brief**

Build `packages/agent`: a TypeScript LiveKit Agents worker that joins a room and runs the cascaded voice pipeline STT → LLM → TTS in Direct mode (one human). Define provider interfaces `SttProvider`, `LlmProvider` (streaming chat with tool calls, token usage, cancel) and `TtsProvider` in `packages/agent/src/providers`, with default adapters: Deepgram STT, Gemini Flash LLM, Cartesia TTS (pick the best available adapter and note alternatives). Use LiveKit's turn detector plus VAD, barge-in (agent stops within about 300 ms and drops the unspoken rest), and backchannel tolerance where the library supports it. Replies short by default (1–3 sentences). Publish agent state (listening / thinking / speaking) as participant attributes so `useAgentState` from T3 works. English and Portuguese: the agent replies in the language of the speaker. Log latency per turn (end of speech to first audio) as structured logs. Tap-to-start only: the agent joins when the server dispatches it (add `POST /v1/rooms/:id/agent` in the server that dispatches the worker; for now locally started). Provide a local run script and a mock-provider test suite. Verify the current LiveKit Agents JS/TS API before coding and note any gaps in the PR.

**Done looks like**: a person on the T3 test page can talk to the agent and interrupt it; per-turn latency logs exist; tests with mock providers pass.

**Dani: manual steps**: create API keys for Deepgram, Cartesia and Google AI Studio (Gemini free key) and put them in `.env` locally and in secrets (`DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `GEMINI_API_KEY`). Set provider-side spend limits at once (these tie into the £50/month budget).

---

## T5: Warm-up endpoint and Cloud Run deploy

- **depends_on**: T4
- **Plan**: sections 2.1 (Verify on Cloud Run), 2.7, chunk 4 (second part), section 6 hosting.

**Brief**

Add `POST /v1/warmup` to the server (authenticated, cheap, idempotent, rate-limited per user; starts or wakes the agent worker only, no STT/LLM/TTS calls) and a `warmup()` call in `@openblah/web` that runs when the client opens and again when the page regains visibility. Design the on-demand dispatch for Cloud Run scale-to-zero: server and agent worker as two Cloud Run services (min instances 0), the worker started on demand by warm-up or by the agent dispatch endpoint (resolve the plan's Verify: a LiveKit Agents worker waits for jobs, so choose between the server triggering a Cloud Run instance via request, or an explicit dispatch API; document the choice and Cloud Run request timeout and CPU-always-allocated settings against call length). If the worker is still cold when the user taps, clients show "connecting" and the call works as a plain room until the agent arrives. Write GitHub Actions workflows to deploy staging and a preview-less production to Cloud Run, including the Viber deploy report steps from CLAUDE.md, using the repo secrets. Measure and record the cold start time of the worker image in `docs/deploy.md` (target under about 3 s; keep the image small).

**Done looks like**: warm-up works end to end in staging; the cold start number is in the docs; the deploy workflow includes the Viber report step.

**Dani: manual steps**

- GCP: create the project (or reuse one), enable Cloud Run, Artifact Registry, Secret Manager, create a deploy service account with the needed roles and add its key or workload identity config as a repo secret.
- Add repo secrets `VIBER_URL`, `VIBER_HOOK_SECRET`, `GCP_*` as named in `docs/deploy.md`.

---

## T6: Spike: TypeScript vs Python agent latency

- **depends_on**: T4 (after_ready)
- **Plan**: section 2.1 Verify, chunk 4 (latency spike). **Spike, no production change.**

**Brief**

Build the same pipeline (same providers, same prompts) as a Python LiveKit Agents worker under `spikes/agent-python/` and compare it with the TypeScript worker from T4: end of speech to first agent audio (median and p95 over at least 30 turns, in English and Portuguese), turn-detection quality (false cut-offs, missed ends), feature gaps (barge-in, backchannel, multi-participant hooks), image size and cold start. Write `docs/spike-agent-language.md` with the numbers, the method and a clear recommendation. The rule from the plan: stay on TypeScript unless it measurably lags; if it does, say exactly what to change. Do not change `packages/agent`.

**Done looks like**: the report exists with a recommendation and reproducible measurement scripts.

**Dani: manual steps**: run the measurement script against real provider keys (needs your keys and a quiet room). The task will print the exact commands; send the results back if the session could not run them.

---

## T7: `@openblah/react-native` SDK and Expo example app

- **depends_on**: T3, T2
- **Plan**: section 4 packages, section 5 (SDK ships with an Expo example), chunk 5.

**Brief**

Build `packages/react-native` with the same API as `@openblah/web` (same client, hooks `useRoom`, `useParticipants`, `useAgentState`, `useMute`, same warm-up call), over `@livekit/react-native`, for Expo dev builds (not Expo Go; state it in the README). Share types and logic with the web package through a small shared core where it avoids duplication (e.g. `packages/core`, update the workspace). Add an Expo config plugin setup (verify the current LiveKit RN and Expo steps), iOS background audio mode and the audio session `playAndRecord` so the call survives screen lock, and Bluetooth/AirPods routing. Add `apps/example` (Expo dev-build example app) that joins a room with a token and shows participants, agent state and a mute button. Do not run the app; write unit tests for the hooks with a mocked client and document the build steps.

**Done looks like**: typecheck and tests pass; `docs/react-native.md` explains `expo prebuild` and running the dev build; the example app compiles in CI via typecheck.

**Dani: manual steps**

- On your Mac: `pnpm install`, then in `apps/example` run `npx expo prebuild` and `npx expo run:ios --device` with a free provisioning profile (7-day signing). No paid Apple account needed yet.
- Test with a second tab (T3 test page) and report any audio, screen-lock or Bluetooth problems.

---

## T8: Spike: multi-participant agent

- **depends_on**: T4
- **Plan**: section 2.3 (biggest Verify), chunk 6. **Spike.**

**Brief**

Find out how one agent session can listen to several human participants in one LiveKit room. Check what LiveKit Agents JS currently supports (the default AgentSession links to one participant) and, if needed, build our own: one STT stream per human audio track, a merged speaker-tagged transcript (`[Penelope]: ...`), VAD-gated audio into STT (cost saving from plan section 6), and a "should I speak?" classifier (small fast model through `LlmProvider`, outputs `speak` / `stay_quiet` plus a reason, logged). Make it testable offline with recorded audio fixtures: a script that replays two or three WAV files as separate participants (generate synthetic TTS fixtures in English and Portuguese, including cases "addressed by name", "humans talking to each other", "opinion requested"). Write `docs/spike-multi-participant.md` with findings, what works, what needs custom code, STT cost per track, and the recommended structure for T9. Put the reusable code under `packages/agent/src/group/`.

**Done looks like**: the fixture replay produces a speaker-tagged transcript and classifier decisions; the report answers the Verify in plan section 2.3.

**Dani: manual steps**: none for the code. Optional: record a short real fixture of you and Penelope for tuning.

---

## T9: Group behaviour and notes

- **depends_on**: T8
- **Plan**: sections 2.5, 2.6 (modes), 4 (built-ins), chunk 7.
- **Open question**: **Q1 (agent name)**. Assumed default: configurable `agentName`, default "Blah".

**Brief**

Turn the T8 spike into the real agent behaviour. Modes per room, switchable by voice or button (the button via server API plus SDK later in T11/T21): **Listening** (default, never speaks unless addressed), **Facilitating** (may speak briefly at natural pauses: decision reached, open action, long silence after a question, time check), **Direct** (one to one with the host). Speak only when addressed by name (name from room config, never hard-coded), when a person asked it for an opinion in the last turn, or when a Facilitating rule fires; the "should I speak?" classifier runs on each finished turn, logs its decision, never speaks over two humans (wait about 1 s of pause). Address detection must treat "Penelope, what do you think?" as not addressed to the agent. Replies 1–3 sentences. Add a "mute the agent" control for everyone (agent state `muted` visible to all clients) and visible state attributes. Built-in agent tools: notes, action list, and a post-call summary generated at the end (in the language of the room) stored through the server storage interface (full history screens come in T19). Tests with the T8 fixtures, including the "stay quiet" cases, and a classifier eval script.

**Done looks like**: fixture tests show silence while two humans talk, an answer when addressed, correct notes and a summary; mode changes work.

**Dani: manual steps**: none (a real call with Penelope is the success test later; see T22).

---

## T10: Invites, consent and host controls (server)

- **depends_on**: T2
- **Plan**: section 3, section 7 consent flow, chunk 8 (server half).

**Brief**

Add to the server: invite tokens (random, default 24 h expiry, tied to one room, limited or single use, revocable by the host), `POST /v1/rooms/:id/invites`, `DELETE .../invites/:id`, a public `POST /v1/invites/:token/join` that takes a guest display name and consent and returns a LiveKit token for a participant of type `guest`. Invite link format `https://openblah.web.app/j/<token>` (base URL configurable). Consent API: record per-participant consent (text version, timestamp) when the agent is on or first brought in; refuse to dispatch the agent until every current participant has consented or the host overrides the room to AI off. Guest rights enforced in token grants and server checks: cannot invoke tools on host accounts, cannot change agent mode, cannot see other participants' contact details. Host controls: invite, remove participant, end room, set agent mode, approve tool actions (the approval endpoint is a stub until T13). Consent text is a versioned file that includes the processors list placeholder (filled in T19) and the agent name (Q1, assumed "Blah", configurable). Rate-limit the public join endpoint. Tests for expiry, revoke, reuse limits, guest rights.

**Done looks like**: tests pass; an OpenAPI-style description of the new endpoints is in `docs/api.md`.

**Dani: manual steps**: none.

---

## T11: Invites and consent in both SDKs and the agent

- **depends_on**: T10, T3, T7, T4
- **Plan**: section 3, section 7, chunk 8 (client half).
- **Open question**: **Q1 (agent name)**, for the announcement and consent wording. Assumed "Blah", configurable.

**Brief**

Expose the T10 features in `@openblah/web` and `@openblah/react-native`: `createInvite`, `revokeInvite`, `joinWithInvite(token, displayName, consent)`, a consent hook and a typed participant role (`host`, `member`, `guest`), host actions (remove participant, end room), and the mid-call invite flow (host taps Invite, share-sheet in RN, copy link on web). In the agent: on entry say "<agent name> is here and listening", again when someone joins; honour a "pause AI" control that stops all listening for everyone with a visible indicator, and a "stop listening or leave" voice request. Add the voice command "<agent name>, invite my mother" implemented as an agent tool that asks the host app for the contact (callback to the host app, share sheet is enough). Update the dev test page and example app. Tests for the new hooks and agent behaviour with mocks.

**Done looks like**: from the dev test page, host creates an invite, a second browser joins as a guest with consent, a pause control works; tests pass.

**Dani: manual steps**: none (universal links need the Apple account and come in T26).

---

## T12: MCP client in the agent

- **depends_on**: T4
- **Plan**: sections 4, 4.1 (connecting MCP servers), chunk 9 (first part).

**Brief**

Make the agent an MCP client over Streamable HTTP with SSE fallback (verify the current MCP spec first; stdio is not supported). The server list is per room: host-defined servers passed at room creation plus (later, T15) the user's saved servers. Support a **host-passed user token**: the embedding product sends its logged-in user's token with the room, and the agent sends it as the bearer token to that product's MCP server (no OAuth screen). Convert MCP tool schemas to the function-calling format inside each `LlmProvider` adapter (Gemini first). A per-room **allow-list** of tools set by the host keeps prompts short. Voice behaviour: tool results summarised for speech, long results to the screen/notes channel, tool names never spoken, slow tools get a short spoken hold plus a visible "working" state. Read-only tools run freely; for now every tool marked as changing anything is blocked until T13. Action log: who asked, which tool, arguments, result status, stored with the room. In a group room a tool call uses the credentials of the person who owns the connection and only when that person asked (add the ownership field now). Tests against a local fake MCP server.

**Done looks like**: with a local MCP test server, the agent answers a spoken question by calling a read-only tool; the action log has an entry; tests pass.

**Dani: manual steps**: none (the test uses a local fake MCP server; Housekeeper's MCP server URL is needed in T23).

---

## T13: Write-action confirmation and webhook tools

- **depends_on**: T12
- **Plan**: section 4 (tool safety, webhook tools), section 7 (tool actions logged), chunk 9 (second part).

**Brief**

Implement the confirmation flow for tools that change anything (book, send, pay): the agent reads back what it will do ("Book a table for four at 19:30 at X, OK?") and runs it only after spoken or tapped confirmation from the **owner of the tool credentials**, never any other participant. Add the server approval endpoint (replacing the T10 stub) and the SDK hook `useToolApprovals` in both packages, with a confirmation UI element in the dev test page. Decide read vs write from MCP tool annotations (`readOnlyHint`) and fall back to "write" when unknown; the host can override per tool. Add **webhook tools**: JSON-schema tool definitions with a callback URL passed at room creation (signed requests with an HMAC secret, timeout, same confirmation rules). Log every action in the action log with confirmation evidence. Tests for: unconfirmed write is not executed, confirmation by a non-owner is rejected, webhook signature, timeout.

**Done looks like**: tests prove the rules above; docs updated in `docs/tools.md`.

**Dani: manual steps**: none.

---

## T14: Key modes, trial and accounts

- **depends_on**: T2, T4
- **Plan**: section 4.1 (who pays, free-tier data), section 6 (trial budget), chunk 10 (key part).
- **Open questions**: **Q2** (trial: sign-in, one per account/device), assumed sign-in required, 300 s per account plus best-effort per-device limit and a global cap. **Q5** (TeraPay data terms), assumed `sensitive` rooms refuse free-tier keys. **Q6** (sign-in method), assumed Firebase Auth, email link and Google; the server accepts a verified Firebase ID token for the standalone app's own users.

**Brief**

Add the key modes to the server and agent: (1) **product key**: the embedding product's provider keys, configured per API key; (2) **BYOK**: a user's own provider keys, stored encrypted at rest (AES-GCM with a key from Secret Manager or env, key rotation field), never logged or returned after saving, used only for that user's rooms, with a delete endpoint; (3) **trial** on OpenBlah's hosted key: 300 seconds of agent audio per account (counted server-side by seconds the agent speaks and listens), a per-device soft limit, and a global cap; (4) self-hosted is the same as product key. In a group room the host's key pays. A room flagged `sensitive` refuses keys marked free-tier and shows the data terms; the user marks a key's tier when saving. Account model: minimal user record for the standalone app (verified Firebase ID token), with an `is_test` flag where relevant. Provide endpoints and typed SDK methods `saveKey`, `deleteKey`, `getTrialStatus`. Tests for encryption round trip, trial exhaustion, sensitive-room refusal, key never leaving the server.

**Done looks like**: tests prove the rules; `docs/keys-and-trial.md` explains the modes.

**Dani: manual steps**

- Create a Firebase project (or reuse the GCP one) and enable Auth with email link and Google. Add the project ID as a repo secret.
- Create a Secret Manager secret for the key-encryption key (`KEY_ENCRYPTION_SECRET`).

---

## T15: MCP OAuth connect flow

- **depends_on**: T12, T14
- **Plan**: section 4.1 (per-user auth), chunk 10 (OAuth part), section 11 (token storage risk).

**Brief**

Per-user OAuth for MCP servers following the current MCP authorization spec (OAuth 2.1 with PKCE, dynamic client registration where supported; verify the spec and which servers support it): `POST /v1/mcp/connections` starts a connection and returns the authorization URL, the server hosts the callback, stores access and refresh tokens encrypted (reusing the T14 store) per user per MCP server, refreshes them, and the agent calls tools with that user's token. Voice never carries credentials. Endpoints to list, test and disconnect/delete connections. SDK methods in both packages that open the browser or in-app sheet for the consent and report the result. Saved servers per user are merged into a room's server list with the host-defined ones, with the host allow-list still applying. Include a small test MCP server with OAuth in `tools/test-mcp-oauth/` and an end-to-end test against it. Minimal scopes, easy disconnect.

**Done looks like**: the end-to-end test connects to the test server, calls a tool, refreshes an expired token and disconnects (tokens deleted).

**Dani: manual steps**: decide which real MCP server to try with OAuth (suggested: one you control, e.g. a Housekeeper server if it supports OAuth, or a public one that supports dynamic registration) and register an OAuth client if it needs one.

---

## T16: Model-agnostic providers and eval set

- **depends_on**: T12
- **Plan**: section 4.1 (which LLM powers the agent), section 11 (MCP voice quality), chunk 11 (first part).

**Brief**

Harden the `LlmProvider` interface (streaming chat with tool calls, token usage, cancel) and add OpenAI and Claude adapters beside the Gemini default. The agent loop, the "should I speak?" classifier and notes must use only this interface, never a vendor SDK directly (add a lint rule or test that enforces it). Convert MCP tool schemas into each vendor's format in its adapter. Check that the STT and TTS interfaces are equally swappable by adding a second adapter for each (e.g. AssemblyAI or OpenAI STT; ElevenLabs or OpenAI TTS). Build a small **eval set** (spoken requests as text and audio fixtures, in English and Portuguese → expected tool calls and arguments) using a fake MCP server, and a script `pnpm eval` that runs it on every configured adapter and prints tool-call accuracy and latency; verify tool-call latency and streaming-tool support of each vendor's current models. Selection is by config at three levels with precedence room, user/product, server default (the settings UI is T17). Verify pt-BR quality and natural voices for the TTS adapters and record in `docs/providers.md`.

**Done looks like**: all three LLM adapters pass the same contract tests; `pnpm eval` runs against any adapter whose key is set and writes a results table to `docs/providers.md`.

**Dani: manual steps**: provide API keys for OpenAI and Anthropic and, optionally, ElevenLabs and AssemblyAI as repo secrets or in `.env` to run the eval; counted against the £50 budget (the eval is small).

---

## T17: Model setting, onboarding hook and MCP settings tool

- **depends_on**: T14, T16
- **Plan**: section 4.1 (model as a setting at three levels), chunk 11 (second part).

**Brief**

Implement the model setting at three levels (room, user/product, server default) with the precedence in the plan: server endpoints to read and change it, validation that the chosen provider has a usable key (BYOK, product key or trial), and an **onboarding hook** in both SDKs (`useOnboarding`: which provider, add key, check key, start the trial) that apps can render themselves. Add a **settings MCP tool** exposed by the OpenBlah server (read and change the model, language override, agent name) so the agent or another client can change it by voice or text; changes use the write-confirmation rule from T13. Suggest the free Gemini key first in the onboarding copy. Tests for precedence, validation, and that a settings change by voice needs confirmation.

**Done looks like**: tests pass; saying "switch to Claude" in a fixture run triggers a confirmation and then changes the setting.

**Dani: manual steps**: none.

---

## T18: Optional agent per room

- **depends_on**: T9, T10
- **Plan**: section 2.6, chunk 12.

**Brief**

Implement the room `agent` state: `off` (plain call), `on` (agent present in Listening/Facilitating/Direct), created with `on | off | ask` (default `ask`: off until someone invites it). The agent worker is dispatched only when the state flips to `on` and leaves when it flips to `off` and when the last human leaves; in `off` no audio goes to STT, LLM or TTS. By default only the host can bring the agent in; a room setting "anyone can add the agent" allows any participant; non-host requests become an approval prompt to the host unless that setting is on. Voice requests to change state only work while the agent is present. Late consent: when the agent is first brought in, every participant is asked again (reuse the T10 consent API and show the consent line); the agent does not listen until all consent, or the host keeps it off. Calls work fully with the agent off (add tests). Expose `useAgentControl` (bring in, send out, request, approve) in both SDKs and update the dev page and example app. Add an idle timeout setting (agent leaves after N minutes of silence).

**Done looks like**: tests show no STT/LLM/TTS calls in `off`, host-only default, approval flow, late consent; docs in `docs/rooms.md`.

**Dani: manual steps**: none.

---

## T19: Call history, retention and delete

- **depends_on**: T9, T10
- **Plan**: section 7, chunk 15 (history part).
- **Open questions**: **Q3** (guest access to history), assumed: the invite link stays valid for read-only history for 30 days. **Q4** (default retention), assumed 30 days, host-configurable (30 days / 1 year / until deleted).

**Brief**

Store and serve call history: per room a transcript, notes, action list, summary and action log, saved only if the host turns "save notes" on; audio never stored. Endpoints and SDK hooks (`useHistory`, `useCall`) to list past calls and read one; visible only to people who were in that call (app users by user ID; guests through their invite token under the Q3 default, behind one policy function so the rule is easy to change). Host controls: retention setting per room or per host (Q4 default 30 days), a scheduled cleanup job (Cloud Scheduler hitting a protected endpoint), and a delete button/endpoint for the host that removes everything for that call. No notes are ever sent to anyone (no email, no push). Fill the processors list into the consent text from T10 and the README (LiveKit, STT, LLM, TTS providers; data location and retention terms per provider: verify each, plan section 7) and add a short privacy and data section to the README (UK GDPR and LGPD notes: minimisation, deletion, lawful basis; not legal advice). Tests for access rules, retention cleanup, delete.

**Done looks like**: tests prove access, retention and deletion; the processors list and privacy section are in the README.

**Dani: manual steps**: confirm Q3 and Q4 when you can; create the Cloud Scheduler job named in `docs/deploy.md` (the task prints a `::viber-manual::` marker with the command).

---

## T20: Cost controls and usage log

- **depends_on**: T14, T5
- **Plan**: section 6 (cost controls, £50 cap), chunk 15 (cost part).

**Brief**

Add per-room max duration, an idle timeout, per-user and per-host monthly minute caps (product key mode needs per-user caps), and a usage log per room: LiveKit participant-minutes, STT audio seconds per track, TTS characters, LLM tokens in/out, estimated cost per provider from a configurable price table (verify real prices and note the date). Add an in-server monthly provider-cost counter that stops the trial key and demo rooms at £50 (hard cap) and notifies Dani at 80% (a structured log line plus an optional webhook URL). Add a read-only usage endpoint for the host. Put the per-minute cost model formula and the VAD-gated STT note into the README. Document the GCP billing budget with alerts at £25, £40 and £50 and the provider-side limits in `docs/costs.md`, and add a script that checks the budget exists and prints a `::viber-manual::` marker if not. Tests for caps, cost counter, trial stop at the hard cap.

**Done looks like**: tests prove caps and the £50 stop; `docs/costs.md` exists.

**Dani: manual steps**

- In GCP Billing create a budget of £50/month on the project with alerts at 50%, 80% and 100% (£25 / £40 / £50).
- Set spend limits at Deepgram, Cartesia and Google Cloud/Gemini quotas (done; there is no OpenAI or ElevenLabs account).
- Confirm the current LiveKit free-tier limits against the pricing page (minutes, concurrent participants, agent hosting) and tell the session if they differ from `docs/costs.md`.

---

## T21: SDK ready components, docs and API stability

- **depends_on**: T3, T7, T11, T13, T17, T18, T19
- **Plan**: section 4, section 8 MVP list, chunk 13 (first part).

**Brief**

Make the SDK complete and stable across `@openblah/web` and `@openblah/react-native`. API stability pass: same names and behaviour in both, remove leftovers, mark exports public or internal, add semver notes. Ready components: `<OpenBlahRoom />` (join, mute, participants, agent state, consent, invite, agent control, tool approvals) for web and RN, themable and replaceable by hooks. Write documentation: API reference (generated from TSDoc, committed under `docs/api-reference/`), a quickstart (create a room, mount the component, in under 15 minutes), and a **host integration guide** (three steps from plan section 4, embedding with MCP tools, product key vs BYOK, warm-up, sensitive rooms, per-user tokens). Update both example apps and keep the dev test page. Run a licence check on all dependencies (MIT-compatible) and write `docs/licences.md`. Add a changeset setup for versioning.

**Done looks like**: both example apps use only the public API; reference and quickstart are present; licence check passes in CI.

**Dani: manual steps**: none.

---

## T22: Publish 0.x release

- **depends_on**: T21, T20
- **Plan**: section 4 (publish early, before Housekeeper), section 8, chunk 13 (second part).

**Brief**

Prepare and run the first npm release: package `files`, `exports`, types, provenance, `publishConfig`, a release GitHub Actions workflow (on a tag or manual dispatch, publishing with `NPM_TOKEN` and provenance) for `@openblah/web`, `@openblah/react-native` and `@openblah/server` as 0.1.0 (the agent worker is published as a Docker image or kept private; state the choice), CHANGELOG, and a README install section with an honest "0.x, may change" note. Add the MVP success-test script to `docs/mvp-check.md`: a 10-minute call between Dani and Penelope with the agent in the room, which stays silent while they talk, answers when asked, and produces correct notes. Do not publish from the coding session: the workflow does it after Dani triggers it.

**Done looks like**: a dry-run publish (`pnpm publish --dry-run`) succeeds for each package; the release workflow is in place.

**Dani: manual steps**

- Create the `@openblah` npm organisation (or confirm the scope name) and an automation token; add it as the repo secret `NPM_TOKEN`.
- Trigger the release workflow manually once the preview of this task looks right.
- Run the MVP success test with Penelope when ready.

---

## T23: Housekeeper integration guide

- **depends_on**: T22
- **Plan**: section 4.1 (Housekeeper), chunk 14.

**Brief**

This repo gets a **Housekeeper integration guide**, `docs/integrations/housekeeper.md`, and a brief for the work in the Housekeeper repo. The guide covers: how to replace Housekeeper's current mic button with `@openblah/react-native` (installing the 0.x package, Expo dev build config plugin, minting a room token from Housekeeper's backend with the OpenBlah API key, passing the logged-in user's token so the agent reaches Housekeeper's MCP server, allow-listing tools, which tools need confirmation, product key mode, per-user minute caps from T20, the warm-up ping on app open, single-user Direct mode with the agent on). Include a tested sample backend route and mounting code under `examples/housekeeper-style/` that runs against a local fake MCP server. At the end of the guide, add a ready-to-paste Viber task brief for the Housekeeper repo (a separate PR there) and a short feedback checklist to collect after use (latency, tool-call mistakes, voice quality, interruptions, Portuguese quality). TeraPay is **not** part of this task (it waits for Q5 and paid-tier keys).

**Done looks like**: guide and example exist and are tested; the Housekeeper brief is at the end of the guide.

**Dani: manual steps**

- Create the task in the Housekeeper repo from the brief at the end of the guide, once this one is merged.
- Give the Housekeeper MCP server URL and how it accepts the user token (tell us if it needs changes).

---

## T24: Standalone app: shell, sign-in and calls

- **depends_on**: T22
- **Plan**: section 5, chunk 16 (first part), section 4.1 (standalone).
- **Open questions**: **Q6** (sign-in), assumed Firebase Auth with email link and Google. **Q2** (trial), assumed sign-in required, 300 s per account. **Q1** (agent name) assumed "Blah", configurable.

**Brief**

Build `apps/app`, the installable standalone OpenBlah app as an Expo dev build that uses **only the public SDK** (no private APIs; any gap found is fixed in the SDK, not worked around). Screens: sign-in (Q6 default), onboarding (choose model, add your own key with the free Gemini key suggested first, or start the 5-minute trial; reuse `useOnboarding`), settings (model, key, language override, agent name), home with "Start talking" (tap to start, no wake word), a call screen (participants, agent state, mute, agent in or out, mode switch Listening / Direct, consent screen before joining with the agent), and the warm-up ping on open and on foreground. Background audio, screen lock and Bluetooth work through the SDK from T7. Do not run the app; write component tests and document the build in `docs/app.md`. Preview test login rules in CLAUDE.md apply if this adds login (mark `is_test`, preview only).

**Done looks like**: typecheck and tests pass; `docs/app.md` explains the build; the flow sign in → onboarding → call is covered by tests with a mocked SDK.

**Dani: manual steps**: build and run on your iPhone dev build (free provisioning); report problems. Create the sign-in providers in Firebase (done in T14).

---

## T25: Standalone app: invites, MCP servers and history

- **depends_on**: T24, T15, T19
- **Plan**: section 4.1 (standalone), chunk 16 (second part).

**Brief**

Extend `apps/app` with: **invite by link** during a call (share sheet; the guest uses the browser page, see T29, until universal links exist); **connect MCP servers**: add a server by URL, full OAuth sign-in through the T15 flow, list, test and disconnect, and choose per room which servers are on; **call history** with transcripts and summaries (T19), host retention and delete controls, and room settings (save notes, anyone can add the agent). Works alone (1:1 Direct) or in a group room, with the agent on or off. Component tests with a mocked SDK; update `docs/app.md`.

**Done looks like**: tests pass; a user can add an MCP server, talk to it by voice, invite someone, and read the summary afterwards (described as manual checks in the PR).

**Dani: manual steps**: try with one real MCP server you control (the same server as in T15).

---

## T26: Standalone app: TestFlight and universal links

- **depends_on**: T24
- **Plan**: sections 3 (Verify), 5, 9, chunk 16 (TestFlight). **Needs the Apple developer account (about December 2026).**

**Brief**

Prepare the app for TestFlight and universal links: bundle ID, app icons and splash placeholders, EAS Build/Submit config (or documented Xcode steps), the Associated Domains entitlement for `openblah.web.app` and the `apple-app-site-association` file served from Firebase Hosting (and the Android App Links file, for later), so `https://openblah.web.app/j/<token>` opens the app if installed and the web page otherwise. Add Sign in with Apple to the app (required by the App Store when other third-party sign-in is offered, Q6 default). Check which capabilities (Associated Domains, background audio) need the paid account (the plan's Verify in section 9). Write `docs/release-ios.md`. When the owner steps are missing, scripts print a `::viber-manual::` marker.

**Done looks like**: the config and AASA file are in place and linted; the release guide is complete.

**Dani: manual steps**

- Enrol in the Apple Developer Program, then create the App ID with Associated Domains and Sign in with Apple, and an App Store Connect app record.
- Add the EAS or App Store Connect credentials as secrets named in `docs/release-ios.md`.
- Upload the build and invite yourself in TestFlight.

---

## T27: Apple Watch spike

- **depends_on**: T24
- **Plan**: section 5, chunk 17. **Spike. Needs Xcode, an Apple Watch and ideally the Apple developer account.**

**Brief**

Find out whether LiveKit's Swift SDK runs on watchOS. If yes, document the minimal client. If not, prototype the plan's fallback: the watch records and plays audio itself and streams it over WebSocket to a new OpenBlah server endpoint that bridges into the room as a participant (needs no phone). Only if that also fails, prototype a WatchConnectivity relay through the iPhone. The watch always talks to the cloud itself, with or without the phone nearby. Define the tiny watch protocol "start session / stop / mute / agent state / transcript line" in `docs/watch-protocol.md`, reusable later for Wear OS. Check Apple's current rules for microphone use in the background and whether a complication can launch into audio capture (the tap opens the app in the foreground). Put the Xcode project under `spikes/watch/` and the WebSocket bridge, if needed, in `packages/server` behind a flag. Write `docs/spike-apple-watch.md` with findings. Dani has a regular Apple Watch (no Action Button).

**Done looks like**: the report states what works and the chosen route with evidence; the protocol is written down; the bridge exists if needed.

**Dani: manual steps**

- Open `spikes/watch/` in Xcode on your Mac, run on your Apple Watch, and report results. The task writes the exact steps in the report (`git checkout feat/...` on your Mac).
- A free provisioning profile may be enough to test; the paid account is needed to distribute.

---

## T28: Apple Watch complication MVP

- **depends_on**: T27
- **Plan**: section 5, chunk 18.

**Brief**

Build the Apple Watch app on the route chosen in T27: a complication (raise wrist, tap, talk), a start/stop/mute screen, agent state and the latest transcript line, over the T27 protocol, talking to the cloud itself with or without the phone nearby, sign-in carried over from the phone app. Server side: whatever the T27 route needs, with tests. Keep all logic on the server; the watch is a thin audio client. Document in `docs/watch.md`. Wear OS is out of scope (Roadmap).

**Done looks like**: the project builds in Xcode (documented), server parts are tested, `docs/watch.md` has install and test steps.

**Dani: manual steps**: install the watch build on your own Apple Watch and test raise-wrist, tap, talk with the phone nearby and away.

---

## T29: Guest web page (desktop)

- **depends_on**: T11, T3
- **Plan**: section 3, chunk 20. May be pulled forward while no Apple account exists (section 9).
- **Open question**: **Q3** (guest access to history): assumed 30-day read-only history through the invite link, linked after the call if T19 is live; the page works without it.

**Brief**

Build `apps/guest-web` using only `@openblah/web`: the page behind `https://openblah.web.app/j/<token>`. Flow: open the link, enter a display name, read and accept the consent line (shown when the agent is on, or when it is first brought in; includes the agent name, assumed "Blah"), mic check (permission and level meter), join, then show participants, mute, agent state and a leave button; guest rights apply (no agent controls). Friendly states: link expired, revoked, room ended, mic blocked, unsupported browser. Desktop Chrome, Safari and Firefox first. Deploy config for Firebase Hosting (`openblah.web.app`) with a preview channel per pull request and the Viber preview report step from CLAUDE.md. Show a "view call history" link when the call has ended if the T19 history API is available (feature check). Tests for the states and a Playwright smoke test against a mocked server. If the page has any login, follow the preview test login rules in CLAUDE.md (not expected).

**Done looks like**: tests pass; the preview shows the invite page with a mocked or real token; hosting config is committed.

**Dani: manual steps**

- Create the Firebase project and the `openblah` Hosting site so `openblah.web.app` exists (or tell us the real site ID), and add the Firebase deploy credentials as a repo secret.
- Test in desktop Chrome, Safari and Firefox with a real invite from the dev page.

---

## T30: Mobile browser join (low priority)

- **depends_on**: T29
- **Plan**: chunk 21. Nice to have, no redesign.

**Brief**

Make the guest page work on mobile Safari and Chrome where cheap: audio unlock on the join tap, mic permission handling, a wake lock to reduce screen-off drops, a clear banner for background limits ("keep this tab open"), safe-area and touch-size CSS, and a note when the browser cannot join. Accept the limits and document them in `docs/mobile-browser.md`. No redesign and no native-app deep links beyond what T26 provides.

**Done looks like**: layout checks at mobile widths in the Playwright test, the limits documented.

**Dani: manual steps**: try the invite link on your phone (iPhone Safari and, if you have one, Android Chrome) and report what breaks.

---

## Not scheduled (Roadmap)

Wear OS spike and app (chunk 19, waiting for a device), wake word (needs Q1 and a name), built-in booking tools, OpenBlah's own MCP server, custom domain for invite links, standing rooms, push-based calling, TeraPay integration (waits for Q5 and paid-tier keys), OpenPocket integration, release 1.0 and demo video.
