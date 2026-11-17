# measure (spike T6)

Scripts that compare the TypeScript worker (`packages/agent`) and the Python worker (`spikes/agent-python`). Method and results go in `docs/spike-agent-language.md`.

Needs real keys in `.env` at the repo root (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `GEMINI_API_KEY`, plus `GOOGLE_API_KEY` = the same Gemini key for Python, and `CARTESIA_VOICE_ID` for the test prompts). Use a quiet machine with a stable network; run both workers from the same machine and region.

    cd spikes/measure
    python -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
    set -a; . ../../.env; set +a
    # terminal 1: TS worker      pnpm --filter @openblah/agent dev
    python measure.py --worker ts --turns 30     # 30 turns per language
    # stop it, terminal 1: Python worker   (cd ../agent-python && python worker.py dev)
    python measure.py --worker py --turns 30
    python compare.py                              # markdown table
    ./image-and-cold-start.sh 5                    # image sizes + cold start, needs docker

Run each worker in `dev` mode or `start` mode, but the same for both. Alternate the two runs (ts, py, ts, py) at least twice to see network noise. Prompts are synthesised once with Cartesia into `prompts/` (or drop in your own 24 kHz mono 16-bit WAVs with the same names; a real voice in a real room is the better test).
