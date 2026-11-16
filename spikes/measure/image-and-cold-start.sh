#!/usr/bin/env bash
# Build both worker images, report size, and time cold start (container start ->
# worker registered with LiveKit). Needs docker and a .env with the keys.
# Usage: spikes/measure/image-and-cold-start.sh [runs]   (run from anywhere)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUNS="${1:-5}"
ENVFILE="$ROOT/.env"
[ -f "$ENVFILE" ] || { echo "::viber-manual::{\"reason\":\"no .env with provider keys\",\"action\":\"Create $ENVFILE from .env.example with LIVEKIT_*, DEEPGRAM_API_KEY, CARTESIA_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY\",\"commands\":[\"cp .env.example .env\"],\"verify\":\"rerun this script\"}"; exit 1; }

docker build -q -f "$ROOT/spikes/measure/ts.Dockerfile" -t openblah-agent-ts "$ROOT" >/dev/null
docker build -q -f "$ROOT/spikes/agent-python/Dockerfile" -t openblah-agent-py "$ROOT/spikes/agent-python" >/dev/null
for img in ts py; do
  echo "image openblah-agent-$img: $(docker image inspect openblah-agent-$img --format '{{.Size}}' | awk '{printf "%.0f MB", $1/1e6}')"
done

cold() { # image -> seconds until the log shows the worker registered
  local img="$1" name="cold-$1-$$" start end
  start=$(date +%s.%N)
  docker run -d --rm --name "$name" --env-file "$ENVFILE" -e GOOGLE_API_KEY="${GOOGLE_API_KEY:-${GEMINI_API_KEY:-}}" "openblah-agent-$img" >/dev/null
  for _ in $(seq 1 600); do
    if docker logs "$name" 2>&1 | grep -qi "registered worker"; then
      end=$(date +%s.%N); docker stop -t 1 "$name" >/dev/null
      echo "$end - $start" | bc -l | awk '{printf "%.2f\n", $1}'; return
    fi
    sleep 0.1
  done
  docker stop -t 1 "$name" >/dev/null; echo "timeout"
}
for img in ts py; do
  echo "cold start $img (s, start -> registered):"
  for i in $(seq 1 "$RUNS"); do cold "$img"; done
done
