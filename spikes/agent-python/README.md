# agent-python (spike T6)

Python twin of `packages/agent`, for the TypeScript vs Python comparison in `docs/spike-agent-language.md`. Not used by the app. Same providers (Deepgram nova-3 multi, Gemini 2.5 Flash, Cartesia sonic-3), same prompt, same turn-handling numbers, same `turn_latency` log line. Registers as `openblah-agent-py`.

    cd spikes/agent-python
    python -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt
    python worker.py download-files
    set -a; . ../../.env; set +a     # LIVEKIT_*, DEEPGRAM_API_KEY, CARTESIA_API_KEY, GOOGLE_API_KEY
    python worker.py dev

The Python Google plugin reads `GOOGLE_API_KEY`; set it to the same value as `GEMINI_API_KEY`.
