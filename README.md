# OpenBlah

**An open-source voice layer for group conversations, with an AI in the middle.**

> **Status:** early and under active development. Nothing described below exists yet; it is all planned.

Think of OpenBlah as a walking meeting room. Your phone stays in your pocket, you talk, and you can invite others (family, colleagues) into the same voice room. They can join through the app, or through a browser link with nothing to install.

The AI agent is a participant in the room. It:

- listens and takes notes
- answers, or gives its opinion, when asked
- searches or does tasks using your own tools
- knows when to stay quiet

Voice only at first. No video.

## Planned

- A hosted voice server built on [LiveKit](https://livekit.io)
- npm packages for web and React Native (Expo), so other apps can add good voice by installing one package
- Later, an Apple Watch client: tap a watch-face complication and talk

## Install

```sh
npm install @openblah/web react react-dom                      # browsers
npx expo install @openblah/react-native @livekit/react-native @livekit/react-native-webrtc livekit-client  # Expo dev builds
```

**0.x, may change.** These packages are at 0.1.0. The API can change in any minor release until 1.0, so pin an exact version. See [CHANGELOG.md](CHANGELOG.md), [docs/quickstart.md](docs/quickstart.md) and [docs/sdk-stability.md](docs/sdk-stability.md).

What is published: `@openblah/web`, `@openblah/react-native`, `@openblah/server` and `@openblah/core` (the shared code the two SDKs depend on; use the SDKs, not core). The agent worker (`@openblah/agent`) is not on npm: it is private and ships as a Docker image built from `packages/agent/Dockerfile`. Releases are made by the Release workflow (`.github/workflows/release.yml`) with npm provenance.

## Repo layout

A pnpm workspaces monorepo (Node 20+, TypeScript strict).

| Path                    | Package                         | What it will be                                       |
| ----------------------- | ------------------------------- | ----------------------------------------------------- |
| `packages/server`       | `@openblah/server`              | Hosted voice server (LiveKit rooms, tokens, API keys) |
| `packages/agent`        | `@openblah/agent`               | The AI agent that joins rooms                         |
| `packages/core`         | `@openblah/core`                | Client and hooks shared by the web and RN packages    |
| `packages/web`          | `@openblah/web`                 | npm package for browsers                              |
| `packages/react-native` | `@openblah/react-native`        | npm package for React Native (Expo)                   |
| `apps/app`              | `@openblah/app` (private)       | Standalone app                                        |
| `apps/example`          | `@openblah/example` (private)   | Expo dev-build example for the React Native SDK       |
| `apps/guest-web`        | `@openblah/guest-web` (private) | Browser guest page                                    |
| `docs/`                 |                                 | Plan, tasks, quickstart, host guide, API reference    |

Each package currently holds only a placeholder `src/index.ts` and a test.

## Commands

```sh
pnpm install     # install dependencies
pnpm typecheck   # tsc in every package
pnpm lint        # ESLint and Prettier check
pnpm test        # Vitest
pnpm build       # build every package
pnpm format      # fix formatting
```

Copy `.env.example` to `.env` for the variables later tasks will use. CI runs the same four checks on pull requests.

## Server

`packages/server` runs with `pnpm --filter @openblah/server dev` (needs a `.env`, see `.env.example`). Endpoints and Cloud Run deploy steps are in [docs/deploy.md](docs/deploy.md).

## Costs

Per-minute provider cost model:

```
cost/min ≈ LiveKit participant-minutes (humans + agent)
         + STT (per audio minute, per human track)
         + TTS (per character spoken)
         + LLM (tokens in/out)
```

STT is billed per human track, so a 4-person call costs about 4x the STT of a 1:1 call. Audio is
**VAD-gated**: it only goes to STT when speech is detected, so silent tracks cost nothing, and with
the agent off nothing goes to STT, LLM or TTS. The server keeps a usage log per room, per-room
duration and idle limits, per-user and per-host monthly minute caps, and a £50/month cap on the
hosted trial key. Prices, settings and the owner steps are in [docs/costs.md](docs/costs.md).

## Privacy and data

_Not legal advice. Have a lawyer check this before you handle personal data of people in the UK or Brazil._

**What is stored.** Audio is never stored: it streams to speech-to-text and is discarded. A call's
transcript, notes, action list, summary and action log are stored **only if the host turns "save notes" on**
for the room. They are shown only to people who were in that call (app users by user ID; guests through
their invite link for 30 days) and are never sent to anyone (no email, no push). The host can delete a
call's history at any time (`DELETE /v1/history/:roomId`); everything else is deleted automatically
after the room's retention: 30 days (default), 1 year or until deleted
(`PUT /v1/rooms/:id/history-settings`). A scheduled job (Cloud Scheduler calling
`POST /internal/history/cleanup`, see [docs/deploy.md](docs/deploy.md)) does the cleanup.

**Processors.** These third parties handle call data in the default setup. Each provider's own
retention and data-location terms apply and change; **check each before launch** (open item, not verified
in code). Paid-tier or enterprise terms differ from free-tier terms, which is why `sensitive` rooms refuse free-tier keys.

| Processor        | Does                                                 | Data it sees                | Where to check terms                          |
| ---------------- | ---------------------------------------------------- | --------------------------- | --------------------------------------------- |
| LiveKit          | Relays call audio (WebRTC)                           | Live audio, participant ids | LiveKit Cloud privacy policy and DPA          |
| Deepgram         | Speech to text (default)                             | Speech audio per speaker    | Deepgram data-retention / "mip" opt-out docs  |
| Google Gemini    | Language model (default)                             | Transcript text, tool data  | Gemini API terms (paid vs free tier training) |
| Cartesia         | Text to speech (default)                             | The agent's reply text      | Cartesia privacy policy and DPA               |
| Your own choices | OpenAI, Claude, AssemblyAI, ElevenLabs when selected | As above                    | That provider's terms                         |

The same list is in the consent line every participant accepts (`DEFAULT_PROCESSORS` in
`packages/server/src/consent.ts`; change it with the `processors` option when you use other providers).

**UK GDPR / LGPD notes.**

- _Lawful basis:_ consent of each participant, recorded with the text version and time before the agent listens (UK GDPR Art. 6(1)(a); LGPD Art. 7, I). Guests can still join with the agent off.
- _Minimisation:_ no audio is stored; history is off unless the host enables it; contact details are not part of history.
- _Retention and deletion:_ time-limited by default (30 days); the host can delete any time, which removes the history and summary. Handle erasure requests from other participants through the host.
- _International transfers:_ the processors above may process data outside the UK/EU/Brazil; confirm transfer terms (SCCs / adequacy) with each.

## Licence

Open source under the [MIT licence](LICENSE).

The React Native SDK and its example app are described in [docs/react-native.md](docs/react-native.md).
