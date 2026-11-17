# Spike T6: TypeScript vs Python agent worker

**Status: harness built, numbers not yet measured.** The coding session had no provider keys or LiveKit project, so nothing below is a measurement. Run the commands in "How to run" and fill in the tables. Until then the recommendation is the plan's default.

## Recommendation (provisional)

**Stay on TypeScript** (`packages/agent` unchanged). The plan's rule is to switch only if TypeScript measurably lags. Switch to Python only if, over at least 30 turns per language:

- TS median end of speech to first audio is more than about 150 ms worse than Python, or TS p95 is more than about 300 ms worse (both bigger than the run-to-run noise seen when each worker is run twice), or
- TS has clearly more false cut-offs or missed ends, or
- a feature the product needs (see gaps below) is missing in TS and cannot be added in a small patch.

If the switch is triggered, change only the worker: replace `packages/agent` with `spikes/agent-python/worker.py` promoted to `apps/agent-py` (or similar), keep the server dispatch name `openblah-agent` (set `OPENBLAH_AGENT_PY_DISPATCH_NAME`), and keep every other package in TypeScript. Provider interfaces (T4) would then be re-implemented in Python for T9/T16.

## What was built

| Piece                                                                                | What it is                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spikes/agent-python/worker.py`                                                      | Python LiveKit Agents worker, same providers (Deepgram nova-3 `multi`, Gemini 2.5 Flash, Cartesia sonic-3), same system prompt, same turn-handling numbers, same language word lists, same `turn_latency` JSON log. Dispatch name `openblah-agent-py`. |
| `spikes/measure/measure.py`                                                          | One harness for both workers: joins a fresh room as a human, dispatches the named worker, plays a spoken prompt in real time and timestamps end of speech and first agent audio.                                                                       |
| `spikes/measure/compare.py`                                                          | Markdown table from the two result files.                                                                                                                                                                                                              |
| `spikes/measure/image-and-cold-start.sh`, `ts.Dockerfile`, `agent-python/Dockerfile` | Image size and cold start (container start to "registered worker"), both with model files baked in.                                                                                                                                                    |

`packages/agent` was not changed.

## Method

- **Latency**: the harness waits for the agent's greeting to finish, then sends a prompt at real-time speed over WebRTC. End of speech = the last speech sample sent. First audio = first received agent frame above an RMS gate (3 frames in a row). Both timestamps come from the harness clock, so the workers' clocks do not matter, and both workers share the same client-to-LiveKit path. The result includes network transport and the agent's own end-of-turn wait (about 400 ms endpointing minimum), which is what a user feels. The workers' own `turn_latency` logs (`e2e_latency` split by stage) are kept for the breakdown.
- **Sample**: 30 turns per language (English, Portuguese), cycling 5 plain questions and 2 mid-pause prompts. Latency statistics use the plain turns; mid-pause turns are for turn detection. Run the whole thing at least twice per worker, alternating.
- **Turn-detection quality**: mid-pause prompts have a 1.2 s pause inside the sentence. An agent that starts talking during the pause is a **false cut-off**. No reply within 8 s of the last word is a **missed end**.
- **Image size / cold start**: `docker image inspect` size; cold start is container start to the worker logging "registered worker", median of 5 runs. This is the worker-ready time, not a Cloud Run measurement (T5 measures that).
- **Same inputs**: same prompts, same Deepgram, Gemini and Cartesia settings, same machine and LiveKit project, one worker at a time.

## Results

Fill in from `python compare.py`. Date, machine, region and network of the run: _to fill in_.

| language | metric                              | TypeScript | Python |
| -------- | ----------------------------------- | ---------- | ------ |
| EN       | median end of speech to audio (ms)  | _tbd_      | _tbd_  |
| EN       | p95 (ms)                            | _tbd_      | _tbd_  |
| PT       | median (ms)                         | _tbd_      | _tbd_  |
| PT       | p95 (ms)                            | _tbd_      | _tbd_  |
| both     | false cut-offs (of mid-pause turns) | _tbd_      | _tbd_  |
| both     | missed ends                         | _tbd_      | _tbd_  |
| -        | image size (MB)                     | _tbd_      | _tbd_  |
| -        | cold start, worker ready (s)        | _tbd_      | _tbd_  |

Target from the plan: under about 1.2 s from end of speech to first audio.

## Feature gaps

Not yet verified against the installed versions; check each while running the spike and update. "TS" is `@livekit/agents` as pinned in `packages/agent`.

| Feature                                    | TypeScript (T4 worker)                                                                     | Python (spike worker)                                          | Verified |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------- |
| Barge-in (stop within about 300 ms)        | `interruption.minDuration`, used in T4                                                     | `min_interruption_duration`                                    | no       |
| Backchannel tolerance                      | `resumeFalseInterruption`, `falseInterruptionTimeout`, used in T4                          | `resume_false_interruption`, `false_interruption_timeout`      | no       |
| Multilingual turn detector                 | `turnDetector.MultilingualModel`                                                           | `turn_detector.multilingual.MultilingualModel`                 | no       |
| Preemptive generation                      | `preemptiveGeneration`                                                                     | `preemptive_generation`                                        | no       |
| Multi-participant hooks (Group mode, T10+) | to check: session links one participant; per-participant STT streams would be our own code | to check: same limit (one linked participant), same workaround | no       |
| Per-turn metrics                           | `item.metrics` (`e2eLatency`, ...)                                                         | `item.metrics["e2e_latency"]`, ...                             | no       |

The plan flags multi-participant support as the biggest unknown. Record here whether either SDK's `AgentSession` can take more than one linked participant, and how much of the Group-mode code each language would need.

## How to run

See `spikes/measure/README.md`. In short: fill `.env`, start the TS worker and run `python measure.py --worker ts --turns 30`, then the Python worker with `--worker py`, then `python compare.py` and `./image-and-cold-start.sh 5`, and paste the numbers above.

## Limits of this spike

- One machine and one network; LiveKit Cloud region and distance dominate absolute numbers, so only the TS-vs-Python difference matters.
- Synthesised prompts are cleaner than a real voice; use your own recordings or speak live for a harder turn-detection test.
- LLM and TTS latency vary by minute; interleave runs.
