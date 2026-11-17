import { detectAddressee } from "./addressing.js";
import type { RoomMode } from "./types.js";

export { AGENT_MUTED_ATTRIBUTE, MODE_ATTRIBUTE } from "../room-control.js";

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

/** Remove a leading "Hey Blah," style vocative; returns the rest, or null when the agent is not named first. */
export function stripVocative(text: string, agentName: string): string | null {
  const re = new RegExp(
    `^\\s*(?:(?:hey|hi|hello|ok|okay|ola|oi|ei|entao|so)[\\s,]+)*${escape(norm(agentName))}\\b[\\s,:;-]*`,
    "u",
  );
  const n = norm(text);
  const m = re.exec(n);
  if (!m) return null;
  // Normalisation (NFD + mark removal) can shorten the string; map back by counting kept chars.
  return realign(text, m[0].length);
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop the first `len` characters of the normalised form from the original text. */
function realign(text: string, len: number): string {
  let kept = 0;
  let i = 0;
  for (const ch of text) {
    if (kept >= len) break;
    kept += norm(ch).length;
    i += ch.length;
  }
  return text.slice(i).trim();
}

const MODE_WORDS: Array<[RoomMode, RegExp]> = [
  [
    "facilitating",
    /\b(facilitat\w*|facilitador\w*|moderat\w*|moderador\w*|chip in|speak up|fale mais|participe)\b/,
  ],
  [
    "direct",
    /\b(direct|one[- ]on[- ]one|one to one|just (me|us two)|so comigo|individual|direto)\b/,
  ],
  [
    "listening",
    /\b(listening|listen only|just listen|only listen|passive|so ouca|apenas ouca|ouvindo|somente ouvir|so ouvir)\b/,
  ],
];

/**
 * "Blah, switch to facilitating mode" / "Blah, just listen" / "Blah, modo
 * facilitador". The agent has to be named first, so ordinary talk about modes
 * between humans never switches anything.
 */
export function parseModeCommand(
  text: string,
  agentName: string,
  otherNames: readonly string[] = [],
): RoomMode | null {
  if (detectAddressee(text, agentName, otherNames).kind !== "agent") return null;
  const rest = stripVocative(text, agentName);
  if (rest === null) return null;
  const t = norm(rest);
  if (
    !/\b(mode|modo|switch|change|go|set|be|become|troque|mude|fique|vire|just|only|so|apenas|somente|facilitat\w*|listen\w*)\b/.test(
      t,
    )
  )
    return null;
  for (const [mode, re] of MODE_WORDS) if (re.test(t)) return mode;
  return null;
}

/** "Blah, mute yourself" / "Blah, you can talk again". */
export function parseMuteCommand(text: string, agentName: string): "mute" | "unmute" | null {
  const rest = stripVocative(text, agentName);
  if (rest === null) return null;
  const t = norm(rest);
  if (
    /\b(unmute|talk again|speak again|you can (talk|speak)|volte a falar|pode falar|desmute\w*|desative o mudo)\b/.test(
      t,
    )
  )
    return "unmute";
  if (
    /\b(mute( yourself| up)?|be quiet|stay quiet|silence|shush|fique quieto|fique quieta|silencie|cale\b|mude-se)/.test(
      t,
    )
  )
    return "mute";
  return null;
}

export type NoteCommand =
  { kind: "note"; text: string } | { kind: "action"; text: string; owner?: string };

const ACTION_LEAD =
  /^(?:please\s+|por favor\s+)?(?:add (?:an? )?(?:action(?: item)?|to-?do|task)|new action|action item|adicione (?:uma )?(?:acao|tarefa)|nova acao|acao)\s*(?:that|:|-|,|para|de)?\s*/;
const NOTE_LEAD =
  /^(?:please\s+|por favor\s+)?(?:take (?:a )?note|make (?:a )?note|note(?: down)?|write down|anote|anota|registre|tome nota)\s*(?:that|:|-|,|de que|que)?\s*/;

/** "Blah, note that we chose Friday" / "Blah, add an action: Penelope sends the invoice". */
export function parseNoteCommand(
  text: string,
  agentName: string,
  participantNames: readonly string[],
): NoteCommand | null {
  const rest = stripVocative(text, agentName);
  if (rest === null) return null;
  const n = norm(rest);
  const act = ACTION_LEAD.exec(n);
  if (act) {
    const body = realign(rest, act[0].length)
      .replace(/[.!]+$/, "")
      .trim();
    if (!body) return null;
    const first = body.split(/\s+/)[0]?.replace(/[,:]+$/, "") ?? "";
    const owner = participantNames.find((p) => norm(p) === norm(first));
    return { kind: "action", text: body, ...(owner ? { owner } : {}) };
  }
  const note = NOTE_LEAD.exec(n);
  if (note) {
    const body = realign(rest, note[0].length).trim();
    return body ? { kind: "note", text: body } : null;
  }
  return null;
}

/** Short spoken confirmations. Names come from the room config, never hard-coded. */
export const modePhrases = {
  mode: (mode: RoomMode, lang: "en" | "pt"): string => {
    const en = {
      listening: "Okay, I will only listen unless someone asks me.",
      facilitating: "Okay, I will help move things along.",
      direct: "Okay, it is just the two of us now.",
    };
    const pt = {
      listening: "Certo, só vou ouvir, a menos que alguém me peça.",
      facilitating: "Certo, vou ajudar a conversa a andar.",
      direct: "Certo, agora é só entre nós dois.",
    };
    return (lang === "pt" ? pt : en)[mode];
  },
  note: (lang: "en" | "pt") => (lang === "pt" ? "Anotado." : "Noted."),
  action: (lang: "en" | "pt") => (lang === "pt" ? "Tarefa adicionada." : "Action added."),
  unmuted: (lang: "en" | "pt") => (lang === "pt" ? "Estou de volta." : "I am back."),
};
