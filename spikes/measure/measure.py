"""Measure end of speech -> first agent audio for a LiveKit agent worker (spike T6).

The same script drives both workers, so the numbers are comparable. For each
turn it joins a fresh room as a "human", dispatches the named worker, plays a
spoken prompt in real time, and timestamps:

  end of speech  = the moment the last speech sample is sent
  first audio    = the first received agent audio frame above a loudness gate

Both clocks are this process's, so the worker's clock does not matter. The
number includes the same network path for both workers (client <-> LiveKit).

Turn-detection quality uses a prompt with a pause in the middle ("midpause"):
an agent that starts talking before the second half is sent is a false
cut-off; no reply within MISSED_END_S after the last word is a missed end.

Usage:
  python measure.py --worker ts|py --turns 30 [--out results/ts.json]
Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and for generating
prompts CARTESIA_API_KEY + CARTESIA_VOICE_ID (or put your own 24 kHz mono
16-bit WAVs in prompts/ named en-1.wav, pt-1.wav, en-mid-1a.wav + en-mid-1b.wav ...).
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
import wave
from pathlib import Path

import numpy as np
from livekit import api, rtc

HERE = Path(__file__).parent
PROMPTS = HERE / "prompts"
RATE = 24000
FRAME_MS = 20
SPF = RATE * FRAME_MS // 1000
GATE_RMS = 600  # int16 RMS; speech from the agent is well above, line noise below
GATE_FRAMES = 3  # consecutive loud frames to count as first audio
TRAIL_S = 0.0  # we keep sending silence after speech; end of speech is the last speech sample
MISSED_END_S = 8.0
MIDPAUSE_S = 1.2
DISPATCH = {"ts": "openblah-agent", "py": "openblah-agent-py"}

# (id, language, kind, text). kind "mid" has two halves split at "|".
SCRIPT = [
    ("en-1", "en", "plain", "What is the capital of France?"),
    ("en-2", "en", "plain", "Can you give me a quick tip for sleeping better?"),
    ("en-3", "en", "plain", "How many days are there in a leap year?"),
    ("en-4", "en", "plain", "Tell me something interesting about octopuses."),
    ("en-5", "en", "plain", "What should I cook tonight if I only have rice and eggs?"),
    ("en-m1", "en", "mid", "I am planning a trip to Scotland next month, | what should I pack?"),
    ("en-m2", "en", "mid", "My meeting moved to Thursday, | can you remind me what day that is?"),
    ("pt-1", "pt", "plain", "Qual é a capital do Brasil?"),
    ("pt-2", "pt", "plain", "Você pode me dar uma dica rápida para dormir melhor?"),
    ("pt-3", "pt", "plain", "Quantos dias tem um ano bissexto?"),
    ("pt-4", "pt", "plain", "Me conte uma curiosidade sobre os polvos."),
    ("pt-5", "pt", "plain", "O que eu posso cozinhar hoje só com arroz e ovos?"),
    ("pt-m1", "pt", "mid", "Eu estou planejando uma viagem para São Paulo no mês que vem, | o que eu devo levar?"),
    ("pt-m2", "pt", "mid", "A minha reunião mudou para quinta-feira, | você pode me lembrar que dia é?"),
]


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, (
            f"{path} must be {RATE} Hz mono 16-bit"
        )
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def synth(text: str, lang: str, path: Path) -> None:
    import httpx

    r = httpx.post(
        "https://api.cartesia.ai/tts/bytes",
        headers={
            "X-API-Key": os.environ["CARTESIA_API_KEY"],
            "Cartesia-Version": "2025-04-16",
        },
        json={
            "model_id": "sonic-3",
            "transcript": text,
            "voice": {"mode": "id", "id": os.environ["CARTESIA_VOICE_ID"]},
            "language": lang,
            "output_format": {"container": "wav", "encoding": "pcm_s16le", "sample_rate": RATE},
        },
        timeout=30,
    )
    r.raise_for_status()
    path.write_bytes(r.content)


def prompt_audio(pid: str, lang: str, kind: str, text: str) -> list[np.ndarray]:
    """Return the speech segments for a prompt (one, or two for a mid-pause)."""
    PROMPTS.mkdir(exist_ok=True)
    parts = [t.strip() for t in text.split("|")] if kind == "mid" else [text]
    segs = []
    for i, t in enumerate(parts):
        f = PROMPTS / (f"{pid}.wav" if kind != "mid" else f"{pid}-{'ab'[i]}.wav")
        if not f.exists():
            synth(t, lang, f)
        segs.append(read_wav(f))
    return segs


def pct(xs: list[float], p: float) -> float:
    s = sorted(xs)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


async def run_turn(worker: str, pid: str, lang: str, kind: str, text: str) -> dict:
    url = os.environ["LIVEKIT_URL"]
    key, secret = os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"]
    room_name = f"spike-{worker}-{pid}-{uuid.uuid4().hex[:6]}"
    segs = prompt_audio(pid, lang, kind, text)

    token = (
        api.AccessToken(key, secret)
        .with_identity("spike-human")
        .with_grants(api.VideoGrants(room_join=True, room=room_name))
        .to_jwt()
    )
    lk = api.LiveKitAPI(url.replace("wss://", "https://"), key, secret)
    room = rtc.Room()
    state = {"first_audio": None, "loud": 0, "armed": False, "agent_started_early": False}
    greeting_done = asyncio.Event()
    clock = {"end": None, "mid_end": None}

    async def consume(track: rtc.Track) -> None:
        async for ev in rtc.AudioStream(track, sample_rate=RATE, num_channels=1):
            rms = float(np.sqrt(np.mean(np.frombuffer(ev.frame.data, dtype=np.int16).astype(np.float64) ** 2)))
            loud = rms > GATE_RMS
            now = time.monotonic()
            if not state["armed"]:
                # Greeting: wait for it to finish (1.5 s of quiet after audio started).
                state["last_loud"] = now if loud else state.get("last_loud", 0)
                if state.get("last_loud") and now - state["last_loud"] > 1.5:
                    greeting_done.set()
                continue
            state["loud"] = state["loud"] + 1 if loud else 0
            if state["loud"] >= GATE_FRAMES and state["first_audio"] is None:
                state["first_audio"] = now - GATE_FRAMES * FRAME_MS / 1000
                if clock["end"] is None:
                    state["agent_started_early"] = True  # talked while we were still speaking

    tasks = []

    @room.on("track_subscribed")
    def _sub(track, pub, participant):
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            tasks.append(asyncio.create_task(consume(track)))

    await room.connect(url, token)
    source = rtc.AudioSource(RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    await lk.agent_dispatch.create_dispatch(
        api.CreateAgentDispatchRequest(agent_name=DISPATCH[worker], room=room_name)
    )

    async def send(samples: np.ndarray) -> None:
        """Send int16 samples in real time, one 20 ms frame at a time."""
        t0 = time.monotonic()
        for i in range(0, len(samples), SPF):
            chunk = samples[i : i + SPF]
            if len(chunk) < SPF:
                chunk = np.pad(chunk, (0, SPF - len(chunk)))
            await source.capture_frame(
                rtc.AudioFrame(chunk.tobytes(), RATE, 1, SPF)
            )
            await asyncio.sleep(max(0, t0 + (i // SPF + 1) * FRAME_MS / 1000 - time.monotonic() - 0.04))

    async def silence(seconds: float) -> None:
        await send(np.zeros(int(seconds * RATE), dtype=np.int16))

    result = {"worker": worker, "id": pid, "language": lang, "kind": kind}
    try:
        try:
            await asyncio.wait_for(greeting_done.wait(), 30)
        except asyncio.TimeoutError:
            return {**result, "error": "no greeting from the agent (worker not running or not dispatched)"}
        await silence(0.5)
        state["armed"] = True
        await send(segs[0])
        if kind == "mid":
            clock["mid_end"] = time.monotonic()
            await silence(MIDPAUSE_S)
            result["false_cutoff"] = state["first_audio"] is not None
            if result["false_cutoff"]:
                return result
            await send(segs[1])
        clock["end"] = time.monotonic()
        deadline = clock["end"] + MISSED_END_S
        # Keep "the mic" open with silence while waiting for the reply.
        while state["first_audio"] is None and time.monotonic() < deadline:
            await silence(0.1)
        if state["first_audio"] is None:
            result["missed_end"] = True
        else:
            result["latency_ms"] = round((state["first_audio"] - clock["end"]) * 1000)
            result["early"] = state["agent_started_early"]
            await silence(1.0)
    finally:
        for t in tasks:
            t.cancel()
        await room.disconnect()
        await lk.room.delete_room(api.DeleteRoomRequest(room=room_name))
        await lk.aclose()
    return result


def summarize(rows: list[dict]) -> dict:
    out = {}
    for lang in ("en", "pt", "all"):
        sel = [r for r in rows if lang == "all" or r["language"] == lang]
        lat = [r["latency_ms"] for r in sel if "latency_ms" in r and r["kind"] == "plain"]
        mids = [r for r in sel if r["kind"] == "mid"]
        out[lang] = {
            "plain_turns_measured": len(lat),
            "median_ms": round(statistics.median(lat)) if lat else None,
            "p95_ms": round(pct(lat, 0.95)) if lat else None,
            "mean_ms": round(statistics.mean(lat)) if lat else None,
            "midpause_turns": len(mids),
            "false_cutoffs": sum(1 for r in mids if r.get("false_cutoff")),
            "missed_ends": sum(1 for r in sel if r.get("missed_end")),
            "errors": sum(1 for r in sel if "error" in r),
        }
    return out


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker", choices=["ts", "py"], required=True)
    ap.add_argument("--turns", type=int, default=30, help="turns per language (plain + mid-pause cycled)")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rows = []
    for lang in ("en", "pt"):
        items = [s for s in SCRIPT if s[1] == lang]
        for n in range(args.turns):
            pid, _, kind, text = items[n % len(items)]
            r = await run_turn(args.worker, pid, lang, kind, text)
            rows.append(r)
            print(json.dumps(r), flush=True)
            await asyncio.sleep(1.0)
    summary = summarize(rows)
    print(json.dumps(summary, indent=2))
    out = Path(args.out or HERE / "results" / f"{args.worker}.json")
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps({"turns": rows, "summary": summary}, indent=2))
    print(f"wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
