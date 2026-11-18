import { llm } from "@livekit/agents";
import type { Completer } from "./classifier.js";
import { MergedTranscript } from "./transcript.js";
import type { TranscriptLine } from "./types.js";

export interface Note {
  id: string;
  text: string;
  /** Who asked for it (display name), when known. */
  by?: string;
  atMs: number;
}

export interface ActionItem {
  id: string;
  text: string;
  owner?: string;
  done: boolean;
  atMs: number;
}

/** Notes and action list for one call. */
export class NotesBook {
  private readonly _notes: Note[] = [];
  private readonly _actions: ActionItem[] = [];
  private seq = 0;

  addNote(text: string, atMs = 0, by?: string): Note {
    const n: Note = { id: `n${++this.seq}`, text: text.trim(), atMs, ...(by ? { by } : {}) };
    this._notes.push(n);
    return n;
  }

  addAction(text: string, atMs = 0, owner?: string): ActionItem {
    const a: ActionItem = {
      id: `a${++this.seq}`,
      text: text.trim(),
      done: false,
      atMs,
      ...(owner ? { owner } : {}),
    };
    this._actions.push(a);
    return a;
  }

  /** Mark done by id, or by a case-insensitive piece of the text. */
  completeAction(idOrText: string): ActionItem | null {
    const q = idOrText.trim().toLowerCase();
    const a =
      this._actions.find((x) => x.id === q) ??
      this._actions.find((x) => !x.done && x.text.toLowerCase().includes(q));
    if (!a) return null;
    a.done = true;
    return a;
  }

  get notes(): readonly Note[] {
    return this._notes;
  }
  get actions(): readonly ActionItem[] {
    return this._actions;
  }
  get openActions(): ActionItem[] {
    return this._actions.filter((a) => !a.done);
  }

  /** Spoken or printed form of the open actions. */
  describeOpenActions(lang: "en" | "pt" = "en"): string {
    const open = this.openActions;
    if (!open.length) return lang === "pt" ? "Nenhuma tarefa em aberto." : "No open actions.";
    return open.map((a) => (a.owner ? `${a.owner}: ${a.text}` : a.text)).join("; ");
  }

  /** Built-in agent tools: notes and action list. */
  tools(now: () => number = () => 0, by?: () => string | undefined) {
    return {
      take_note: llm.tool({
        description:
          "Save a short note about something worth remembering from the call, when someone asks. " +
          "Never say or read out the tool name. Confirm with one or two words.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "The note, one sentence." } },
          required: ["text"],
        },
        execute: async (args) => {
          const text = String((args as { text?: unknown }).text ?? "").trim();
          if (!text) return "Nothing to note.";
          this.addNote(text, now(), by?.());
          return "Noted.";
        },
      }),
      add_action: llm.tool({
        description:
          "Add an item to the action list when someone commits to something or asks for a to-do. " +
          "Never say or read out the tool name. Confirm in one short sentence.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "What has to be done." },
            owner: { type: "string", description: "Who does it, if said." },
          },
          required: ["text"],
        },
        execute: async (args) => {
          const a = args as { text?: unknown; owner?: unknown };
          const text = String(a.text ?? "").trim();
          if (!text) return "Nothing to add.";
          const owner = typeof a.owner === "string" && a.owner.trim() ? a.owner.trim() : undefined;
          this.addAction(text, now(), owner);
          return "Action added.";
        },
      }),
      list_actions: llm.tool({
        description:
          "Read out the open action items when asked. Never say or read out the tool name.",
        parameters: { type: "object", properties: {} },
        execute: async () => this.describeOpenActions(),
      }),
      complete_action: llm.tool({
        description:
          "Mark an action item as done when someone says it is finished. Never say or read out the tool name.",
        parameters: {
          type: "object",
          properties: { text: { type: "string", description: "Part of the action's text." } },
          required: ["text"],
        },
        execute: async (args) => {
          const q = String((args as { text?: unknown }).text ?? "");
          return this.completeAction(q) ? "Marked as done." : "I could not find that action.";
        },
      }),
    };
  }
}

/** What is stored when the call ends. The server's `CallSummary` has the same shape. */
export interface CallSummary {
  roomId: string;
  /** Language of `text` (the room's language). */
  language: "en" | "pt";
  text: string;
  notes: string[];
  actions: Array<{ text: string; owner?: string; done: boolean }>;
  participants: string[];
  createdAt: string;
}

/** The server storage interface the summary goes through (the server's `Storage` implements it). */
export interface SummaryStore {
  saveSummary(summary: CallSummary): Promise<void>;
}

export function summarySystemPrompt(agentName: string, lang: "en" | "pt"): string {
  const language = lang === "pt" ? "Brazilian Portuguese" : "English";
  return [
    `You are ${agentName}, writing the post-call summary of a live call between several people.`,
    `Write it in ${language}, in plain text without markdown, at most 120 words.`,
    "Cover what was discussed, what was decided, and what is still open. Use the notes and action list as given; do not invent facts.",
  ].join(" ");
}

/** Plain summary without a model: used when the model is missing or fails. */
export function fallbackSummary(book: NotesBook, lang: "en" | "pt"): string {
  const head = lang === "pt" ? "Resumo da chamada." : "Call summary.";
  const notes = book.notes.length
    ? `${lang === "pt" ? "Notas" : "Notes"}: ${book.notes.map((n) => n.text).join("; ")}.`
    : "";
  const actions = book.actions.length
    ? `${lang === "pt" ? "Tarefas" : "Actions"}: ${book.actions
        .map((a) => `${a.owner ? `${a.owner}: ` : ""}${a.text}${a.done ? " (done)" : ""}`)
        .join("; ")}.`
    : "";
  return [head, notes, actions].filter(Boolean).join(" ");
}

export interface SummaryInput {
  roomId: string;
  agentName: string;
  language: "en" | "pt";
  transcript: readonly TranscriptLine[];
  book: NotesBook;
  participants: string[];
  complete?: Completer;
  store?: SummaryStore;
  now?: () => Date;
}

/** Build the post-call summary in the room's language and store it. Never throws on a model failure. */
export async function finishCallSummary(input: SummaryInput): Promise<CallSummary> {
  const { book, language } = input;
  let text = "";
  if (input.complete && input.transcript.length) {
    const user = [
      `Participants: ${input.participants.join(", ")}`,
      `Notes: ${book.notes.map((n) => n.text).join(" | ") || "none"}`,
      `Actions: ${book.actions.map((a) => `${a.owner ? `${a.owner}: ` : ""}${a.text}${a.done ? " (done)" : ""}`).join(" | ") || "none"}`,
      "Transcript:",
      new MergedTranscript().format(input.transcript),
    ].join("\n");
    try {
      text = (await input.complete(summarySystemPrompt(input.agentName, language), user)).trim();
    } catch {
      text = "";
    }
  }
  const summary: CallSummary = {
    roomId: input.roomId,
    language,
    text: text || fallbackSummary(book, language),
    notes: book.notes.map((n) => n.text),
    actions: book.actions.map((a) => ({
      text: a.text,
      done: a.done,
      ...(a.owner ? { owner: a.owner } : {}),
    })),
    participants: input.participants,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
  };
  await input.store?.saveSummary(summary);
  return summary;
}
