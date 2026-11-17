import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  asksForOpinion,
  detectAddressee,
  MergedTranscript,
  parseDecision,
  replayScenario,
  SCENARIOS,
  SpeakClassifier,
  VadGate,
  readWav,
  writeFixtures,
  writeWav,
  type Completer,
} from "./index.js";

describe("addressing", () => {
  it("treats a vocative for another human as not addressed to the agent", () => {
    expect(detectAddressee("Penelope, what do you think?", "Blah", ["Dani", "Penelope"])).toEqual({
      kind: "other",
      name: "Penelope",
    });
    expect(detectAddressee("what do you think, Penelope?", "Blah", ["Penelope"]).kind).toBe(
      "other",
    );
  });
  it("detects the agent by configurable name, with greetings and accents", () => {
    expect(detectAddressee("Hey Blah, what time is it?", "Blah", ["Dani"]).kind).toBe("agent");
    expect(detectAddressee("Zé, qual é a sua opinião?", "Zé", ["Dani"]).kind).toBe("agent");
    expect(detectAddressee("what do you think, Blah?", "Blah", []).kind).toBe("agent");
    expect(detectAddressee("Blah, what do you think?", "Zed", []).kind).toBe("none");
  });
  it("marks a mid-sentence mention as ambiguous", () => {
    expect(detectAddressee("I asked Blah about it yesterday", "Blah", ["Dani"]).kind).toBe(
      "mention",
    );
  });
  it("finds opinion cues in English and Portuguese", () => {
    expect(asksForOpinion("What do you think about it?")).toBe(true);
    expect(asksForOpinion("O que você acha?")).toBe(true);
    expect(asksForOpinion("I will bring the tickets")).toBe(false);
  });
});

describe("transcript", () => {
  it("merges tracks in time order with speaker tags", () => {
    const t = new MergedTranscript();
    t.add({ identity: "p", speaker: "Penelope", text: "Friday works.", endMs: 5000 });
    t.add({ identity: "d", speaker: "Dani", text: "Shall we pick a date?", endMs: 2000 });
    expect(t.format()).toBe("[Dani]: Shall we pick a date?\n[Penelope]: Friday works.");
  });
});

describe("vad gate", () => {
  const rate = 16000;
  const silent = new Int16Array(320);
  const loud = new Int16Array(320).fill(3000);
  it("forwards only speech plus pre-roll and hangover, and reports savings", () => {
    const g = new VadGate({ hangoverMs: 100, prerollMs: 40 });
    let forwarded = 0;
    let closed = 0;
    const push = (f: Int16Array) => {
      const o = g.push(f, rate);
      forwarded += o.forward.length;
      if (o.closed) closed++;
    };
    for (let i = 0; i < 50; i++) push(silent);
    expect(forwarded).toBe(0);
    for (let i = 0; i < 10; i++) push(loud);
    for (let i = 0; i < 50; i++) push(silent);
    expect(closed).toBe(1);
    expect(forwarded).toBeLessThan(25); // 2 pre-roll + 10 speech + 5 hangover
    expect(g.stats().savedRatio).toBeGreaterThan(0.7);
  });
});

describe("wav", () => {
  it("round-trips", () => {
    const w = { sampleRate: 16000, samples: Int16Array.from([0, 1, -1, 32767]) };
    expect(readWav(writeWav(w))).toEqual(w);
  });
});

describe("classifier", () => {
  const line = (speaker: string, text: string, endMs: number, isAgent = false) => ({
    identity: speaker,
    speaker,
    text,
    endMs,
    isAgent,
  });
  it("parses model JSON and falls back to silence on garbage", () => {
    expect(parseDecision('```json\n{"decision":"speak","reason":"asked"}\n```').decision).toBe(
      "speak",
    );
    expect(parseDecision("hmm").decision).toBe("stay_quiet");
  });
  it("uses the model only for ambiguous turns", async () => {
    let calls = 0;
    const complete: Completer = async () => {
      calls++;
      return '{"decision":"speak","reason":"ask"}';
    };
    const c = new SpeakClassifier({ complete });
    const names = ["Dani", "Penelope"];
    const r1 = await c.classify({
      agentName: "Blah",
      participantNames: names,
      transcript: [line("Dani", "Penelope, what do you think?", 1)],
    });
    const r2 = await c.classify({
      agentName: "Blah",
      participantNames: names,
      transcript: [line("Dani", "I will bring the tickets", 1)],
    });
    expect(r1.decision).toBe("stay_quiet");
    expect(r2.decision).toBe("stay_quiet");
    expect(calls).toBe(0);
    const r3 = await c.classify({
      agentName: "Blah",
      participantNames: names,
      transcript: [line("Dani", "What do you think about it?", 1)],
    });
    expect(r3).toMatchObject({ decision: "speak", source: "llm" });
    expect(calls).toBe(1);
  });
  it("stays quiet when the model fails", async () => {
    const c = new SpeakClassifier({
      complete: async () => {
        throw new Error("boom");
      },
    });
    const r = await c.classify({
      agentName: "Blah",
      participantNames: [],
      transcript: [line("Dani", "what do you think?", 1)],
    });
    expect(r).toMatchObject({ decision: "stay_quiet", source: "fallback" });
  });
});

describe("fixture replay", () => {
  const dir = mkdtempSync(join(tmpdir(), "openblah-group-test-"));
  writeFixtures(dir);

  for (const sc of SCENARIOS) {
    it(`${sc.id}: ${sc.description}`, async () => {
      const res = await replayScenario(sc, { fixturesDir: dir });
      // Every scripted human line shows up, speaker-tagged.
      for (const t of sc.turns.filter((x) => !x.agent)) {
        expect(res.transcript).toContain(`[${t.speaker}]: ${t.text}`);
      }
      expect(res.last?.decision).toBe(sc.expected);
      // One decision per human turn, each with a reason.
      expect(res.decisions).toHaveLength(sc.turns.filter((t) => !t.agent).length);
      expect(res.decisions.every((d) => d.reason.length > 0)).toBe(true);
      // Silent stretches are not sent to STT.
      for (const s of Object.values(res.stats)) expect(s.savedRatio).toBeGreaterThan(0.2);
    });
  }

  it("waits about 1 s after the last human speech before the agent may speak", async () => {
    const sc = SCENARIOS.find((s) => s.id === "en-addressed")!;
    const res = await replayScenario(sc, { fixturesDir: dir });
    expect(res.last!.earliestSpeakMs! - res.last!.turnEndMs).toBeGreaterThanOrEqual(1000);
  });

  it("detects the language of each turn", async () => {
    const sc = SCENARIOS.find((s) => s.id === "pt-addressed")!;
    const res = await replayScenario(sc, { fixturesDir: dir });
    expect(res.last!.language).toBe("pt");
  });
});
