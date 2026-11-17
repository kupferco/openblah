# @openblah/agent

LiveKit Agents (TypeScript) worker: joins a room and runs STT → LLM → TTS for one human (Direct mode). 0.x, unstable.

- Providers (`src/providers`): `SttProvider`, `LlmProvider`, `TtsProvider`. Defaults: Deepgram `nova-3` (multi-language), Gemini Flash, Cartesia `sonic-3`. Alternatives: AssemblyAI/OpenAI/Google STT, OpenAI/Anthropic LLM (T16), ElevenLabs/OpenAI/Google TTS.
- Turn handling: Silero VAD + LiveKit's multilingual turn detector, barge-in after 300 ms of overlapping speech (the unspoken rest is dropped), short "mm-hm" backchannels do not interrupt (the agent resumes).
- Replies: 1–3 sentences; the reply language follows the speaker (English or Portuguese).
- State: LiveKit publishes `lk.agent.state` on the agent participant; `useAgentState` in `@openblah/web` reads it.
- Consent and controls (`src/room-control.ts`, T11): says "<agent name> is here and listening" on entry and again when someone joins (or that it is paused). The agent name comes from the room metadata (default `Blah`). A `pause_ai` data message (topic `openblah.control`) from anyone stops all listening and sets the `openblah.ai_paused` attribute on the agent, which every client shows; the host or the person who paused can resume. Voice tools: `stop_listening_or_leave` ("stop listening" pauses, "leave" leaves) and `invite_participant` ("invite my mother"), which sends an `invite_request` to the host's app only and waits for its `invite_response`.
- Latency: one JSON log line per reply, `{"event":"turn_latency","endOfSpeechToFirstAudioMs":...}`.

## Run locally

1. Fill `.env` (`LIVEKIT_*`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `GEMINI_API_KEY`, `OPENBLAH_API_KEYS`).
2. `pnpm --filter @openblah/agent dev` (worker registers as `openblah-agent`; first run downloads the turn detector model, or run `pnpm --filter @openblah/agent build && pnpm --filter @openblah/agent download-files`).
3. `pnpm --filter @openblah/server dev`, create a room (`POST /v1/rooms`), mint a token (`POST /v1/tokens`), join on the `@openblah/web` dev page.
4. Dispatch the agent: `curl -X POST -H "Authorization: Bearer $KEY" localhost:8080/v1/rooms/<id>/agent`.
