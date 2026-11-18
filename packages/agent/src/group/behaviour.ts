import type { Completer } from "./classifier.js";
import { Facilitator, type FacilitatorOptions } from "./facilitation.js";
import { AGENT_MUTED_ATTRIBUTE, MODE_ATTRIBUTE } from "../room-control.js";
import { modePhrases, parseModeCommand, parseMuteCommand, parseNoteCommand } from "./modes.js";
import { NotesBook } from "./notes.js";
import { ROOM_MODES, type RoomMode, type TranscriptLine } from "./types.js";

/** What the behaviour needs from the room. Mocked in tests; LiveKit in the worker. */
export interface BehaviourPort {
  /** Publish the visible state attributes on the agent participant. */
  publishAttributes?(attrs: Record<string, string>): void;
}

export interface GroupBehaviourOptions {
  agentName: string;
  mode?: RoomMode;
  /** Host user id; only the host may start Direct mode. */
  hostIdentity?: string;
  facilitator?: FacilitatorOptions;
  port?: BehaviourPort;
}

/** Control messages for mode and mute (wire format in room-control.ts / @openblah/core). */
export type BehaviourControl =
  { type: "set_mode"; mode: RoomMode } | { type: "mute_agent"; muted: boolean };

export interface CommandOutcome {
  /** Short label for the log, e.g. `mode:facilitating`. */
  label: string;
  /** What to say back; absent when nothing should be said (muted, or a silent change). */
  say?: string;
}

/**
 * Per-room agent behaviour: the mode, the "mute the agent" flag every client
 * can see, the Facilitating rules and the notes. Independent of LiveKit.
 */
export class GroupBehaviour {
  readonly notes = new NotesBook();
  readonly facilitator: Facilitator;
  private _mode: RoomMode;
  private _muted = false;

  constructor(private readonly opts: GroupBehaviourOptions) {
    this._mode = opts.mode ?? "listening";
    this.facilitator = new Facilitator(opts.facilitator);
  }

  get mode(): RoomMode {
    return this._mode;
  }
  get muted(): boolean {
    return this._muted;
  }
  get hostIdentity(): string | undefined {
    return this.opts.hostIdentity;
  }

  /** Publish the current state, e.g. once when the agent joins. */
  publish(): void {
    this.opts.port?.publishAttributes?.({
      [MODE_ATTRIBUTE]: this._mode,
      [AGENT_MUTED_ATTRIBUTE]: String(this._muted),
    });
  }

  /**
   * Change the mode. Anyone may pick Listening or Facilitating; Direct is one
   * to one with the host, so only the host can start it. Returns false if refused.
   */
  setMode(mode: RoomMode, by?: string): boolean {
    if (!ROOM_MODES.includes(mode)) return false;
    if (mode === "direct" && this.opts.hostIdentity && by !== this.opts.hostIdentity) return false;
    this._mode = mode;
    this.publish();
    return true;
  }

  /** Mute or unmute the agent for everyone. Anyone in the room may do it. */
  setMuted(muted: boolean): void {
    this._muted = muted;
    this.publish();
  }

  /** A button press from a client (data message), via the server API / SDK. */
  onControl(sender: { identity: string } | null, msg: BehaviourControl): boolean {
    if (!sender) return false;
    if (msg.type === "set_mode") return this.setMode(msg.mode, sender.identity);
    this.setMuted(msg.muted);
    return true;
  }

  /**
   * A spoken command: mode change, mute, note or action. Returns null when the
   * turn is not a command. Commands run even while muted (that is how it is unmuted).
   */
  handleVoiceCommand(
    line: TranscriptLine,
    participantNames: readonly string[],
    lang: "en" | "pt",
  ): CommandOutcome | null {
    const { agentName } = this.opts;
    const others = participantNames.filter((n) => n !== line.speaker);
    const mute = parseMuteCommand(line.text, agentName);
    if (mute) {
      this.setMuted(mute === "mute");
      return {
        label: mute,
        say: mute === "unmute" ? modePhrases.unmuted(lang) : undefined,
      };
    }
    const mode = parseModeCommand(line.text, agentName, others);
    if (mode) {
      if (!this.setMode(mode, line.identity)) return { label: `mode:${mode}:refused` };
      return { label: `mode:${mode}`, say: this._muted ? undefined : modePhrases.mode(mode, lang) };
    }
    const note = parseNoteCommand(line.text, agentName, participantNames);
    if (note) {
      if (note.kind === "note") this.notes.addNote(note.text, line.endMs, line.speaker);
      else this.notes.addAction(note.text, line.endMs, note.owner);
      return {
        label: note.kind,
        say: this._muted
          ? undefined
          : note.kind === "note"
            ? modePhrases.note(lang)
            : modePhrases.action(lang),
      };
    }
    return null;
  }
}

/** Keep the first `max` sentences: replies are 1-3 sentences. */
export function clampSentences(text: string, max = 3): string {
  const parts =
    text
      .trim()
      .replace(/\s+/g, " ")
      .match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/gu) ?? [];
  return parts
    .slice(0, max)
    .map((p) => p.trim())
    .join(" ");
}

export function replySystemPrompt(
  agentName: string,
  mode: RoomMode,
  lang: "en" | "pt",
  instruction?: string,
): string {
  const language = lang === "pt" ? "Brazilian Portuguese" : "English";
  return [
    `You are ${agentName}, a voice assistant in a live call${mode === "direct" ? " with the host" : " between several people"}.`,
    `Your reply is spoken aloud: one to three short sentences, plain spoken ${language}, no markdown or lists.`,
    "You see the transcript tagged [Speaker]: text. Answer the last turn directly; do not repeat what people said.",
    instruction ? `Right now: ${instruction}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Generate the spoken reply for a `speak` decision: at most three sentences. */
export async function composeReply(opts: {
  complete: Completer;
  agentName: string;
  mode: RoomMode;
  language: "en" | "pt";
  transcript: string;
  instruction?: string;
}): Promise<string> {
  const raw = await opts.complete(
    replySystemPrompt(opts.agentName, opts.mode, opts.language, opts.instruction),
    `Transcript:\n${opts.transcript}`,
  );
  return clampSentences(raw.replace(/[*_`#]/g, ""), 3);
}
