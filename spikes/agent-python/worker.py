"""Python LiveKit Agents worker for the T6 latency spike.

Mirrors packages/agent (TypeScript): same providers, same prompt, same turn
handling numbers, same latency log line. Registers as "openblah-agent-py" so
the measurement harness can dispatch to either worker explicitly.
"""

import json
import os
import re
from datetime import datetime, timezone

from livekit import agents
from livekit.agents import Agent, AgentSession, JobContext, JobProcess, WorkerOptions, cli
from livekit.plugins import cartesia, deepgram, google, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

AGENT_NAME = os.environ.get("OPENBLAH_AGENT_NAME", "Blah").strip() or "Blah"
DISPATCH_NAME = os.environ.get("OPENBLAH_AGENT_PY_DISPATCH_NAME", "openblah-agent-py")

# Same text as directInstructions() in packages/agent/src/config.ts.
INSTRUCTIONS = " ".join(
    [
        f"You are {AGENT_NAME}, a voice assistant in a live call with one person.",
        "Your replies are spoken aloud, so keep them short: one to three sentences unless the person asks for more.",
        "Use plain spoken language. No markdown, lists, emoji or URLs read out letter by letter.",
        "Always reply in the language the person just spoke. You speak English and Portuguese (Brazilian).",
        "If you did not catch something or it is unclear, ask a short question.",
    ]
)

# Copied from packages/agent/src/language.ts (same word lists, same vote).
PT_WORDS = {"o", "a", "os", "as", "um", "uma", "de", "do", "da", "dos", "das", "em", "no", "na", "nos", "nas", "que", "não", "nao", "sim", "é", "e", "eu", "você", "voce", "vc", "tu", "ele", "ela", "nós", "para", "pra", "por", "com", "como", "quando", "onde", "quem", "qual", "quais", "meu", "minha", "seu", "sua", "isso", "isto", "esse", "essa", "está", "esta", "estou", "são", "foi", "ser", "ter", "tem", "tenho", "pode", "poderia", "obrigado", "obrigada", "olá", "ola", "oi", "bom", "boa", "dia", "tarde", "noite", "mais", "muito", "também", "tambem", "já", "ja", "mas", "se", "me", "te", "fala", "diga", "quero", "preciso", "hoje", "amanhã", "amanha", "reunião", "reuniao", "favor", "aqui", "agora", "então", "entao", "vamos", "dois"}
EN_WORDS = {"the", "a", "an", "and", "is", "are", "was", "to", "of", "in", "on", "for", "with", "that", "this", "it", "you", "i", "we", "he", "she", "they", "what", "when", "where", "who", "how", "why", "can", "could", "would", "should", "do", "does", "did", "have", "has", "not", "no", "yes", "my", "your", "please", "thanks", "thank", "hello", "hi", "hey", "me", "tell", "about", "today", "tomorrow", "meeting", "need", "want", "just", "so", "but", "if", "at", "from"}


def detect_language(text: str, fallback: str = "en") -> str:
    words = re.findall(r"[^\W\d_']+(?:'[^\W\d_]+)*", text.lower())
    if not words:
        return fallback
    pt = en = 0
    for w in words:
        if w in PT_WORDS:
            pt += 1
        if w in EN_WORDS:
            en += 1
        if re.search(r"[ãõçáéíóúâêô]", w):
            pt += 1
    if pt == en:
        return fallback
    return "pt" if pt > en else "en"


class DirectAgent(Agent):
    def __init__(self, tts: cartesia.TTS) -> None:
        super().__init__(instructions=INSTRUCTIONS)
        self._tts_engine = tts
        self.language = "en"

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        nxt = detect_language(new_message.text_content or "", self.language)
        if nxt != self.language:
            self._tts_engine.update_options(language=nxt)
        self.language = nxt


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()
    proc.userdata["turn"] = MultilingualModel()


def ms(seconds) -> int | None:
    return round(seconds * 1000) if isinstance(seconds, (int, float)) else None


async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    tts = cartesia.TTS(model="sonic-3", language="en")
    agent = DirectAgent(tts)
    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3", language="multi", interim_results=True, punctuate=True, smart_format=True
        ),
        llm=google.LLM(
            model="gemini-2.5-flash",
            temperature=0.6,
            max_output_tokens=400,
            thinking_config={"thinking_budget": 0},
        ),
        tts=tts,
        vad=ctx.proc.userdata["vad"],
        turn_detection=ctx.proc.userdata["turn"],
        # Same numbers as turnHandling() in packages/agent/src/pipeline.ts.
        allow_interruptions=True,
        min_interruption_duration=0.3,
        resume_false_interruption=True,
        false_interruption_timeout=2.0,
        min_endpointing_delay=0.4,
        max_endpointing_delay=3.0,
        preemptive_generation=True,
    )
    turn = 0

    @session.on("conversation_item_added")
    def _on_item(ev) -> None:
        nonlocal turn
        item = ev.item
        if item.type != "message" or item.role != "assistant":
            return
        turn += 1
        m = getattr(item, "metrics", None) or {}
        print(
            json.dumps(
                {
                    "event": "turn_latency",
                    "worker": "python",
                    "roomId": ctx.room.name,
                    "turn": turn,
                    "endOfSpeechToFirstAudioMs": ms(m.get("e2e_latency")),
                    "endOfTurnDelayMs": ms(m.get("end_of_turn_delay")),
                    "transcriptionDelayMs": ms(m.get("transcription_delay")),
                    "llmFirstTokenMs": ms(m.get("llm_node_ttft")),
                    "ttsFirstByteMs": ms(m.get("tts_node_ttfb")),
                    "interrupted": bool(item.interrupted),
                    "language": agent.language,
                    "ts": datetime.now(timezone.utc).isoformat(),
                }
            ),
            flush=True,
        )

    await session.start(agent=agent, room=ctx.room)
    session.generate_reply(
        instructions=f"Greet the person briefly as {AGENT_NAME} and ask how you can help."
    )


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(entrypoint_fnc=entrypoint, prewarm_fnc=prewarm, agent_name=DISPATCH_NAME)
    )
