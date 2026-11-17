/**
 * Cheap, deterministic "who is this turn for?" check. Names come from room
 * config (agent) and the participant list (humans); nothing is hard-coded.
 *
 * The important case: "Penelope, what do you think?" is a human talking to a
 * human. A bare "what do you think?" is NOT enough to say the agent was
 * addressed; the classifier resolves those with the model.
 */
export type Addressee =
  | { kind: "agent"; how: "vocative" }
  | { kind: "other"; name: string }
  | { kind: "mention" } // agent named inside a sentence: ambiguous
  | { kind: "none" };

const GREETINGS = new Set([
  "hey",
  "hi",
  "hello",
  "ok",
  "okay",
  "so",
  "and",
  "well",
  "olá",
  "ola",
  "oi",
  "ei",
  "e",
  "então",
  "entao",
  "ó",
]);

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function words(text: string): string[] {
  return norm(text).match(/[\p{L}\p{N}']+/gu) ?? [];
}

/** Does `name` (any case, accents ignored) open the sentence, after greetings? */
function opensWith(text: string, name: string): boolean {
  const ws = words(text);
  let i = 0;
  while (i < ws.length - 1 && GREETINGS.has(ws[i]!) && i < 2) i++;
  return ws[i] === norm(name);
}

/** Does the text end with ", Name" (optionally followed by punctuation)? */
function endsWith(text: string, name: string): boolean {
  const re = new RegExp(`[,;:]\\s*${escape(norm(name))}\\s*[?!.…]*\\s*$`, "u");
  return re.test(norm(text));
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectAddressee(
  text: string,
  agentName: string,
  otherNames: readonly string[],
): Addressee {
  const others = otherNames.filter((n) => norm(n) !== norm(agentName));
  // Opening vocative decides first: "Penelope, ..." / "Hey Blah, ...".
  if (opensWith(text, agentName)) return { kind: "agent", how: "vocative" };
  for (const n of others) if (opensWith(text, n)) return { kind: "other", name: n };
  // Closing vocative: "..., what do you think, Blah?"
  if (endsWith(text, agentName)) return { kind: "agent", how: "vocative" };
  for (const n of others) if (endsWith(text, n)) return { kind: "other", name: n };
  if (words(text).includes(norm(agentName))) return { kind: "mention" };
  return { kind: "none" };
}

const OPINION_CUES = [
  /\bwhat do you think\b/,
  /\bwhat would you (suggest|do|pick|say)\b/,
  /\bany (thoughts|ideas|opinion)/,
  /\byour (opinion|view|take)\b/,
  /\bwhich (one )?would you\b/,
  /\bo que (voce|vc) acha\b/,
  /\bqual (e )?(a )?(sua|tua) opiniao\b/,
  /\balguma (ideia|sugestao)\b/,
  /\bo que (voce|vc) (sugere|faria)\b/,
  /\bna sua opiniao\b/,
];

/** Does the text ask someone for an opinion, without saying who? */
export function asksForOpinion(text: string): boolean {
  const t = norm(text);
  return OPINION_CUES.some((re) => re.test(t));
}
