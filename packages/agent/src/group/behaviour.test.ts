import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BEHAVIOUR_SCENARIOS,
  clampSentences,
  composeReply,
  Facilitator,
  finishCallSummary,
  GroupBehaviour,
  NotesBook,
  parseModeCommand,
  parseMuteCommand,
  parseNoteCommand,
  replayScenario,
  SpeakClassifier,
  writeFixtures,
  type CallSummary,
  type Completer,
} from "./index.js";
import { AGENT_MUTED_ATTRIBUTE, MODE_ATTRIBUTE, parseControlMessage } from "../room-control.js";

const dir = mkdtempSync(join(tmpdir(), "openblah-t9-test-"));
writeFixtures(dir, BEHAVIOUR_SCENARIOS);
const scenario = (id: string) => BEHAVIOUR_SCENARIOS.find((s) => s.id === id)!;

describe("voice commands", () => {
  it("needs the agent's name, taken from config", () => {
    expect(parseModeCommand("Blah, switch to facilitating mode", "Blah")).toBe("facilitating");
    expect(parseModeCommand("Zed, go direct", "Zed")).toBe("direct");
    expect(parseModeCommand("Blah, just listen", "Blah")).toBe("listening");
    expect(parseModeCommand("Blah, modo facilitador", "Blah")).toBe("facilitating");
    expect(parseModeCommand("we should switch to facilitating mode", "Blah")).toBeNull();
    expect(parseModeCommand("Blah, switch to facilitating mode", "Zed")).toBeNull();
    // A vocative for the other human is never a command for the agent.
    expect(parseModeCommand("Penelope, go direct", "Blah", ["Penelope"])).toBeNull();
  });
  it("parses mute and unmute", () => {
    expect(parseMuteCommand("Blah, mute yourself", "Blah")).toBe("mute");
    expect(parseMuteCommand("Blah, you can talk again", "Blah")).toBe("unmute");
    expect(parseMuteCommand("Blah, fique quieto", "Blah")).toBe("mute");
    expect(parseMuteCommand("please mute the music", "Blah")).toBeNull();
  });
  it("parses notes and actions with an owner", () => {
    expect(parseNoteCommand("Blah, note that we chose Friday", "Blah", [])).toEqual({
      kind: "note",
      text: "we chose Friday",
    });
    expect(
      parseNoteCommand("Blah, add an action: Penelope sends the invoice.", "Blah", ["Penelope"]),
    ).toEqual({ kind: "action", text: "Penelope sends the invoice", owner: "Penelope" });
    expect(parseNoteCommand("Blah, what time is it", "Blah", [])).toBeNull();
  });
});

describe("classifier by mode", () => {
  const line = (speaker: string, text: string) => ({
    identity: speaker,
    speaker,
    text,
    endMs: 1000,
  });
  const c = new SpeakClassifier();
  it("never speaks while muted, even when addressed", async () => {
    const r = await c.classify({
      agentName: "Blah",
      participantNames: ["Dani"],
      transcript: [line("Dani", "Blah, what time is it?")],
      muted: true,
    });
    expect(r.decision).toBe("stay_quiet");
  });
  it("direct mode answers the host only", async () => {
    const base = {
      agentName: "Blah",
      participantNames: ["Dani", "Zoe"],
      hostName: "Dani",
      mode: "direct" as const,
    };
    expect(
      (await c.classify({ ...base, transcript: [line("Dani", "How tall is Everest?")] })).decision,
    ).toBe("speak");
    expect(
      (await c.classify({ ...base, transcript: [line("Zoe", "How tall is Everest?")] })).decision,
    ).toBe("stay_quiet");
  });
});

describe("mode and mute state", () => {
  it("publishes visible attributes and checks who may start Direct", () => {
    const published: Array<Record<string, string>> = [];
    const b = new GroupBehaviour({
      agentName: "Blah",
      hostIdentity: "dani",
      port: { publishAttributes: (a) => published.push(a) },
    });
    b.publish();
    expect(published.at(-1)).toEqual({
      [MODE_ATTRIBUTE]: "listening",
      [AGENT_MUTED_ATTRIBUTE]: "false",
    });
    expect(b.onControl({ identity: "penelope" }, { type: "set_mode", mode: "facilitating" })).toBe(
      true,
    );
    expect(b.onControl({ identity: "penelope" }, { type: "set_mode", mode: "direct" })).toBe(false);
    expect(b.mode).toBe("facilitating");
    expect(b.onControl({ identity: "dani" }, { type: "set_mode", mode: "direct" })).toBe(true);
    b.onControl({ identity: "penelope" }, { type: "mute_agent", muted: true });
    expect(published.at(-1)).toEqual({
      [MODE_ATTRIBUTE]: "direct",
      [AGENT_MUTED_ATTRIBUTE]: "true",
    });
  });
  it("parses the control messages", () => {
    expect(parseControlMessage('{"type":"set_mode","mode":"facilitating"}')).toEqual({
      type: "set_mode",
      mode: "facilitating",
    });
    expect(parseControlMessage('{"type":"set_mode","mode":"loud"}')).toBeNull();
    expect(parseControlMessage('{"type":"mute_agent","muted":true}')).toEqual({
      type: "mute_agent",
      muted: true,
    });
  });
});

describe("behaviour fixtures", () => {
  it("stays silent while two humans talk, even in Facilitating mode", async () => {
    const res = await replayScenario(scenario("en-chat-long"), { fixturesDir: dir });
    expect(res.decisions).toHaveLength(4);
    expect(res.decisions.every((d) => d.decision === "stay_quiet")).toBe(true);
  });
  it("facilitates only in Facilitating mode", async () => {
    const on = await replayScenario(scenario("en-decision"), { fixturesDir: dir });
    expect(on.last).toMatchObject({
      decision: "speak",
      facilitation: { kind: "decision_reached" },
    });
    const off = await replayScenario(scenario("en-decision-listening"), { fixturesDir: dir });
    expect(off.last!.decision).toBe("stay_quiet");
    const act = await replayScenario(scenario("en-open-action"), { fixturesDir: dir });
    expect(act.last!.facilitation?.kind).toBe("open_action");
  });
  it("switches mode by voice, and logs it on the decision", async () => {
    const res = await replayScenario(scenario("en-switch-mode"), { fixturesDir: dir });
    expect(res.session.behaviour.mode).toBe("facilitating");
    expect(res.last).toMatchObject({ command: "mode:facilitating", decision: "speak" });
    const pt = await replayScenario(scenario("pt-switch-mode"), { fixturesDir: dir });
    expect(pt.session.behaviour.mode).toBe("listening");
  });
  it("mutes for everyone", async () => {
    const res = await replayScenario(scenario("en-mute"), { fixturesDir: dir });
    expect(res.session.behaviour.muted).toBe(true);
    expect(res.last).toMatchObject({ decision: "stay_quiet", muted: true });
  });
  it("records notes and actions, and answers when asked", async () => {
    const res = await replayScenario(scenario("en-notes"), { fixturesDir: dir });
    const book = res.session.behaviour.notes;
    expect(book.notes.map((n) => n.text)).toEqual(["the launch is on Friday."]);
    expect(book.actions).toMatchObject([{ text: "Penelope sends the invoice", owner: "Penelope" }]);
    expect(res.last!.decision).toBe("speak");
  });
  it("answers the host in Direct mode", async () => {
    const res = await replayScenario(scenario("en-direct"), { fixturesDir: dir });
    expect(res.last).toMatchObject({ decision: "speak", mode: "direct" });
  });
  it("fires the long-silence rule from the clock after an unanswered question", async () => {
    const res = await replayScenario(scenario("en-open-action"), { fixturesDir: dir });
    const s = res.session;
    // New session state: ask a question, then let the clock run.
    const b = new GroupBehaviour({ agentName: "Blah", mode: "facilitating" });
    const f = b.facilitator;
    f.onTurn({ identity: "d", speaker: "Dani", text: "Which hotel should we pick?", endMs: 1000 });
    expect(f.tick(5000, 1000)).toBeNull();
    expect(f.tick(10_000, 1000)?.kind).toBe("long_silence");
    expect(f.tick(20_000, 1000)).toBeNull(); // only once per question
    expect(s.tick(60_000)).toBeNull(); // not a question: nothing to say
  });
});

describe("facilitator", () => {
  it("time check, and a minimum gap between remarks", () => {
    const f = new Facilitator({ timeCheckEveryMs: 60_000, minGapMs: 10_000 });
    expect(f.tick(30_000, 29_000)).toBeNull();
    expect(f.tick(61_000, 50_000)?.kind).toBe("time_check");
    const line = { identity: "d", speaker: "Dani", text: "we decided on Friday", endMs: 65_000 };
    expect(f.onTurn(line)).toBeNull(); // too soon after the last remark
    expect(f.onTurn({ ...line, endMs: 80_000 })?.kind).toBe("decision_reached");
  });
});

describe("replies", () => {
  it("clamps to three sentences", () => {
    expect(clampSentences("One. Two! Three? Four. Five.")).toBe("One. Two! Three?");
    expect(clampSentences("Just one")).toBe("Just one");
  });
  it("composes a short reply through the completer", async () => {
    let system = "";
    const complete: Completer = async (s) => {
      system = s;
      return "**Friday** works. It is close. It is cheap. And more.";
    };
    const r = await composeReply({
      complete,
      agentName: "Blah",
      mode: "listening",
      language: "en",
      transcript: "[Dani]: Blah, Friday?",
    });
    expect(r).toBe("Friday works. It is close. It is cheap.");
    expect(system).toContain("Blah");
    expect(system).toContain("one to three");
  });
});

describe("notes and summary", () => {
  it("keeps notes and an action list, with built-in tools", async () => {
    const book = new NotesBook();
    const tools = book.tools(
      () => 5,
      () => "Dani",
    );
    expect(Object.keys(tools).sort()).toEqual([
      "add_action",
      "complete_action",
      "list_actions",
      "take_note",
    ]);
    book.addNote("Launch Friday");
    book.addAction("send invoice", 0, "Penelope");
    expect(book.describeOpenActions()).toBe("Penelope: send invoice");
    expect(book.completeAction("invoice")?.done).toBe(true);
    expect(book.describeOpenActions("pt")).toBe("Nenhuma tarefa em aberto.");
  });
  it("writes the summary in the room's language and stores it", async () => {
    const book = new NotesBook();
    book.addNote("Lançamento na sexta");
    book.addAction("enviar a fatura", 0, "Penelope");
    const saved: CallSummary[] = [];
    let prompt = "";
    const out = await finishCallSummary({
      roomId: "r1",
      agentName: "Blah",
      language: "pt",
      transcript: [{ identity: "d", speaker: "Dani", text: "Vamos lançar na sexta.", endMs: 1 }],
      book,
      participants: ["Dani", "Penelope"],
      complete: async (s) => {
        prompt = s;
        return "Resumo: lançamento na sexta.";
      },
      store: { saveSummary: async (s) => void saved.push(s) },
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(prompt).toContain("Portuguese");
    expect(out.text).toBe("Resumo: lançamento na sexta.");
    expect(saved).toEqual([out]);
    expect(out.actions).toEqual([{ text: "enviar a fatura", owner: "Penelope", done: false }]);
  });
  it("falls back to a plain summary when the model fails", async () => {
    const book = new NotesBook();
    book.addNote("Launch Friday");
    const out = await finishCallSummary({
      roomId: "r1",
      agentName: "Blah",
      language: "en",
      transcript: [{ identity: "d", speaker: "Dani", text: "x", endMs: 1 }],
      book,
      participants: [],
      complete: async () => {
        throw new Error("down");
      },
    });
    expect(out.text).toBe("Call summary. Notes: Launch Friday.");
  });
});
