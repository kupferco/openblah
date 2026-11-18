import { llm as lk } from "@livekit/agents";
import type { LlmProvider } from "../providers/types.js";
import { asksForOpinion, detectAddressee } from "./addressing.js";
import type { ClassifierInput, ClassifierResult } from "./types.js";

/** Send a prompt, get text back. Small, so tests and evals can inject any model. */
export type Completer = (system: string, user: string, signal?: AbortSignal) => Promise<string>;

/** Adapt an `LlmProvider` (the same interface the voice pipeline uses) to a `Completer`. */
export function completerFromProvider(provider: LlmProvider): Completer {
  const model = provider.createLlm();
  return async (system, user, signal) => {
    const ctx = lk.ChatContext.empty();
    ctx.addMessage({ role: "system", content: system });
    ctx.addMessage({ role: "user", content: user });
    const stream = model.chat({ chatCtx: ctx });
    const onAbort = () => stream.close();
    signal?.addEventListener("abort", onAbort);
    let out = "";
    try {
      for await (const chunk of stream) out += chunk.delta?.content ?? "";
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    return out;
  };
}

export function classifierSystemPrompt(agentName: string): string {
  return [
    `You decide whether the voice assistant "${agentName}" should speak next in a live call between several people.`,
    "You see the last lines of the transcript, each tagged [Speaker]: text. The last line is the turn to judge.",
    `Answer "speak" only if the last turn is clearly for ${agentName}: it names ${agentName} as the addressee, or it asks for an opinion right after ${agentName} spoke, or it asks the assistant something no human could answer.`,
    `Answer "stay_quiet" when people talk to each other, including a question to a named person ("Penelope, what do you think?") or a bare question that most likely goes to the other human.`,
    'Reply with JSON only: {"decision":"speak"|"stay_quiet","reason":"<short reason>"}.',
  ].join(" ");
}

/** Parse the model output; anything unreadable becomes `stay_quiet` (silent is the safe default). */
export function parseDecision(raw: string): ClassifierResult {
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { decision?: unknown; reason?: unknown };
      const reason = typeof j.reason === "string" ? j.reason : "";
      if (j.decision === "speak" || j.decision === "stay_quiet") {
        return { decision: j.decision, reason, source: "llm" };
      }
    } catch {
      /* fall through */
    }
  }
  return { decision: "stay_quiet", reason: "unreadable model output", source: "fallback" };
}

export interface SpeakClassifierOptions {
  /** Small fast model; leave out to run rules only (offline default). */
  complete?: Completer;
  /** How far back (ms of audio clock) a previous agent line still counts as "just spoke". */
  agentFollowUpMs?: number;
  /** Lines of context given to the model. */
  contextLines?: number;
  timeoutMs?: number;
}

/**
 * "Should I speak?" for each finished turn. Order: free rules first (a name
 * said as a vocative, an opinion cue), the model only for the ambiguous rest.
 * Cost: one small-model call per ambiguous turn, none for most turns.
 */
export class SpeakClassifier {
  private readonly complete?: Completer;
  private readonly agentFollowUpMs: number;
  private readonly contextLines: number;
  private readonly timeoutMs: number;

  constructor(opts: SpeakClassifierOptions = {}) {
    this.complete = opts.complete;
    this.agentFollowUpMs = opts.agentFollowUpMs ?? 20_000;
    this.contextLines = opts.contextLines ?? 8;
    this.timeoutMs = opts.timeoutMs ?? 2_000;
  }

  async classify(input: ClassifierInput): Promise<ClassifierResult> {
    const { agentName, participantNames, transcript } = input;
    const turn = transcript[transcript.length - 1];
    if (!turn || turn.isAgent)
      return { decision: "stay_quiet", reason: "no human turn", source: "rule" };
    if (input.muted) {
      return { decision: "stay_quiet", reason: "agent is muted for everyone", source: "rule" };
    }
    if (input.mode === "direct") {
      const host = input.hostName;
      return !host || turn.speaker === host
        ? { decision: "speak", reason: "direct mode: one to one with the host", source: "rule" }
        : { decision: "stay_quiet", reason: "direct mode: not the host", source: "rule" };
    }

    const to = detectAddressee(turn.text, agentName, participantNames);
    if (to.kind === "agent") {
      return { decision: "speak", reason: `addressed by name (${agentName})`, source: "rule" };
    }
    if (to.kind === "other") {
      return { decision: "stay_quiet", reason: `addressed to ${to.name}`, source: "rule" };
    }

    const prev = transcript[transcript.length - 2];
    const followUp = !!prev?.isAgent && turn.endMs - prev.endMs <= this.agentFollowUpMs;
    const cue = to.kind === "mention" || asksForOpinion(turn.text) || followUp;
    if (!cue) return { decision: "stay_quiet", reason: "no cue for the agent", source: "rule" };

    // A follow-up question right after the agent spoke, from the person it spoke to, is for the agent.
    if (!this.complete) {
      return followUp && asksForOpinion(turn.text)
        ? { decision: "speak", reason: "opinion asked right after the agent spoke", source: "rule" }
        : { decision: "stay_quiet", reason: "ambiguous and no model configured", source: "rule" };
    }

    const lines = transcript
      .slice(-this.contextLines)
      .map((l) => `[${l.speaker}]: ${l.text}`)
      .join("\n");
    const user = `Participants: ${participantNames.join(", ")}\nTranscript:\n${lines}`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return parseDecision(await this.complete(classifierSystemPrompt(agentName), user, ac.signal));
    } catch (err) {
      return {
        decision: "stay_quiet",
        reason: `model failed: ${(err as Error).message}`,
        source: "fallback",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
