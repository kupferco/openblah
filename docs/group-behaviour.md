# Group behaviour and notes (T9)

Code: `packages/agent/src/group/`. Built on the T8 spike (`docs/spike-multi-participant.md`).

## Modes

| Mode                  | Speaks when                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listening` (default) | Addressed by name, or a person asked for an opinion right after the agent spoke.                                                                         |
| `facilitating`        | The same, plus a rule fires: decision reached, open action without an owner, long silence after a question (8 s), time check (every 30 min). 45 s apart. |
| `direct`              | Every turn of the host. Turns of anyone else are ignored.                                                                                                |

Switch by voice ("Blah, switch to facilitating mode", "Blah, just listen", "Blah, go direct"; Portuguese too) or by button: a data message `{"type":"set_mode","mode":"facilitating"}` on topic `openblah.control` (the SDK button comes in T11/T21). Only the host can start Direct. The agent has to be named first, so humans talking about modes change nothing.

**Mute the agent** for everyone: "Blah, mute yourself" / "Blah, you can talk again", or `{"type":"mute_agent","muted":true}`. While muted the agent never speaks (it still listens and takes notes silently).

Both states are agent participant attributes, visible to every client: `openblah.mode` and `openblah.agent_muted` (`"true"`/`"false"`). `@openblah/core` exports the constants and message types; the SDK state `muted` for the agent and the buttons are T11.

The agent name is room config (`agentName`, default "Blah"); nothing is hard-coded.

## Who is addressed

`detectAddressee` handles "Penelope, what do you think?" as addressed to Penelope, never to the agent. The classifier runs on each finished turn and logs one JSON line (`group.decision`) with mode, mute state, decision, reason and source (`rule`, `llm`, `fallback`). `speak` decisions carry `earliestSpeakMs`: the agent waits about 1 s after the last human speech. Replies are clamped to 3 sentences (`composeReply`, `clampSentences`).

## Notes, actions, summary

- Voice: "Blah, note that the launch is Friday", "Blah, add an action: Penelope sends the invoice".
- Built-in agent tools (`NotesBook.tools()`): `take_note`, `add_action`, `list_actions`, `complete_action`.
- `finishCallSummary()` writes the post-call summary in the room's language (model through `Completer`; plain fallback if it fails) and stores it through `SummaryStore`. The server `Storage` now has `saveSummary` / `getSummary` (memory and Firestore, collection `summaries`, one per room). History screens are T19.

## Tests and eval

- `pnpm vitest run packages/agent` — fixture tests (silence while two humans talk, answer when addressed, modes, mute, notes, facilitation, summary).
- `pnpm --filter @openblah/agent group:eval` — scores every scenario (T8 plus T9 set). With `GEMINI_API_KEY` ambiguous turns also go to the model.

## Not done here

`GroupSession` is not yet started from `worker.ts`: the worker still runs the one-to-one `DirectAgent`. Joining the per-track audio, TTS playout of `composeReply`, publishing the attributes and calling `finishCallSummary` at room end is integration work for T22 (the summary transport from the agent to the server storage is also left to it).
