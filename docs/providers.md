# Model providers and the eval set

OpenBlah's agent never names a vendor outside `packages/agent/src/providers/`. The voice pipeline, the tool loop and (later) the "should I speak?" classifier and notes only use three small interfaces from `providers/types.ts`:

| Interface     | What it covers                                                                                          | Adapters                               |
| ------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `LlmProvider` | streaming chat with tool calls, token usage and cancel (via `llm.LLM`), plus `formatToolSchema` for MCP | Gemini (default), OpenAI, Claude       |
| `SttProvider` | streaming speech to text                                                                                | Deepgram (default), OpenAI, AssemblyAI |
| `TtsProvider` | text to speech, with `setLanguage` so replies follow the speaker                                        | Cartesia (default), OpenAI, ElevenLabs |

The rule is enforced twice: an ESLint `no-restricted-imports` rule (`pnpm lint`) and a test in `providers/contract.test.ts` that fails if any file outside `providers/` imports a vendor SDK or LiveKit plugin.

## MCP tool schemas

MCP tools carry JSON Schema. Each LLM adapter converts it in `formatToolSchema`:

- **Gemini** (`geminiToolSchema`): reduces it to the OpenAPI-style subset (no `$ref`, `additionalProperties`, `const`, ...; `["string","null"]` becomes `"string"`).
- **OpenAI** (`openaiToolSchema`): non-strict function parameters; drops `$schema` / `$id`, keeps the rest.
- **Claude** (`claudeToolSchema`): `input_schema` must be an object schema; drops `$schema` / `$id`.

## Choosing a provider (three levels)

The LLM, STT and TTS choices resolve **separately**, each from the first level that sets it:

1. **Room**: `providers` in the agent job metadata, e.g. `{"providers":{"llm":{"provider":"claude","model":"claude-haiku-5-5"}}}`.
2. **User / product**: the same shape, passed as `levels.user` to `providersFromLevels`. The settings UI and the settings MCP tool that write it are T17; nothing stores it yet.
3. **Server default**: `OPENBLAH_LLM_PROVIDER`, `OPENBLAH_LLM_MODEL`, `OPENBLAH_STT_PROVIDER`, `OPENBLAH_TTS_PROVIDER`, `OPENBLAH_TTS_VOICE` (see `.env.example`).

Without any of them: Gemini, Deepgram, Cartesia. Unknown provider names in metadata are ignored. Keys always come from the server environment (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`, `CARTESIA_API_KEY`, `ELEVEN_API_KEY`), never from a room.

Default models: Gemini `gemini-3.8-flash` (`GEMINI_MODEL`), OpenAI `gpt-5.4-mini` (`OPENAI_MODEL`), Claude `claude-haiku-5-5` (`ANTHROPIC_MODEL`). These are starting points chosen for speed; the eval below is how to compare them.

## Contract tests

`packages/agent/src/providers/contract.test.ts` runs the same tests against all three LLM adapters, with no keys: each adapter's real LiveKit plugin talks to a local fake server that speaks that vendor's streaming wire format (`fake-vendors.ts`). Each adapter must: build an `llm.LLM`, convert an MCP schema, **stream a tool call with arguments and token usage**, and **end promptly when cancelled** mid-stream. This verifies streaming tool support in the plugins; it does not say anything about the vendors' live models (see the manual run below).

## The eval set and `pnpm eval`

`packages/agent/src/eval/cases.ts` holds 12 spoken requests (English and Brazilian Portuguese, including small talk that must call no tool) with the expected tool and arguments, against a fake MCP server (`fake-mcp.ts`: weather, calendar, restaurants, stock price, currency). The tools go through each adapter's `formatToolSchema`, so conversion bugs show up as wrong calls.

```sh
pnpm eval                      # every LLM adapter whose key is set (reads .env)
pnpm eval --adapters=openai,claude --runs=3
pnpm eval --audio              # also make audio fixtures with a TTS key and run each STT adapter
```

It prints each case, then a table with tool-call accuracy (overall, English, Portuguese) and latency (p50 / p95 ms from request to the first streamed tool call), and rewrites the table below. With `--audio` the spoken text is synthesised with the first TTS adapter that has a key into `packages/agent/eval-audio/` (generated, git-ignored) and each STT adapter that has a key transcribes it; the word error rate per language is printed (not written here).

### Results

<!-- eval-results:start -->

Not run yet: no OpenAI or Anthropic key was available when this was written. Run `pnpm eval` with the keys set to fill in this table.

<!-- eval-results:end -->

## Still to verify with real keys

None of this could be checked without keys, so it is **open**, not done:

- Tool-call latency and streaming-tool behaviour of the current OpenAI, Claude and Gemini models (the table above).
- pt-BR quality of each STT adapter (`pnpm eval --audio` prints word error rate for English and Portuguese).
- Natural pt-BR voices for the TTS adapters. Listen to the WAV fixtures made with each TTS adapter (change the first configured TTS by setting only that key, or use `--adapters`) and note here which voice IDs sound right:

| TTS        | Voice / model used by default             | pt-BR verdict |
| ---------- | ----------------------------------------- | ------------- |
| Cartesia   | `sonic-3`, plugin default voice           | not yet heard |
| OpenAI     | `gpt-4o-mini-tts`, voice `coral`          | not yet heard |
| ElevenLabs | `eleven_flash_v2_5`, plugin default voice | not yet heard |
