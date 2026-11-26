import { llm } from "@livekit/agents";
import type { SpokenLanguage } from "./providers/types.js";

/*
 * Wire format shared with `@openblah/core` (packages/core/src/protocol.ts). The agent
 * runs in Node and does not depend on the browser client, so the constants are repeated:
 * keep both in step.
 */
export const CONTROL_TOPIC = "openblah.control";
export const AI_PAUSED_ATTRIBUTE = "openblah.ai_paused";
/** Agent participant attributes for the room mode and the "mute the agent" state (see group/modes.ts). */
export const MODE_ATTRIBUTE = "openblah.mode";
export const AGENT_MUTED_ATTRIBUTE = "openblah.agent_muted";

export type ControlMessage =
  | { type: "pause_ai"; paused: boolean }
  | { type: "invite_request"; requestId: string; who: string }
  | { type: "invite_response"; requestId: string; status: "sent" | "declined" }
  | { type: "set_mode"; mode: "listening" | "facilitating" | "direct" }
  | { type: "mute_agent"; muted: boolean };

export function parseControlMessage(payload: Uint8Array | string): ControlMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(typeof payload === "string" ? payload : new TextDecoder().decode(payload));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.type === "pause_ai" && typeof m.paused === "boolean") {
    return { type: "pause_ai", paused: m.paused };
  }
  if (
    m.type === "set_mode" &&
    (m.mode === "listening" || m.mode === "facilitating" || m.mode === "direct")
  ) {
    return { type: "set_mode", mode: m.mode };
  }
  if (m.type === "mute_agent" && typeof m.muted === "boolean") {
    return { type: "mute_agent", muted: m.muted };
  }
  if (m.type === "invite_request" && typeof m.requestId === "string" && typeof m.who === "string") {
    return { type: "invite_request", requestId: m.requestId, who: m.who };
  }
  if (
    m.type === "invite_response" &&
    typeof m.requestId === "string" &&
    (m.status === "sent" || m.status === "declined")
  ) {
    return { type: "invite_response", requestId: m.requestId, status: m.status };
  }
  return null;
}

/** What the agent says. Names come from room config (Q1), never hard-coded. */
export const phrases = {
  entry: (agent: string, lang: SpokenLanguage) =>
    lang === "pt" ? `${agent} está aqui e está ouvindo.` : `${agent} is here and listening.`,
  back: (lang: SpokenLanguage) =>
    lang === "pt" ? "Desculpe, perdi você por um instante." : "Sorry, I lost you for a moment.",
  joined: (agent: string, person: string, paused: boolean, lang: SpokenLanguage) => {
    if (lang === "pt") {
      return paused
        ? `${person} entrou. ${agent} está em pausa e não está ouvindo.`
        : `${person} entrou. ${agent} está aqui e está ouvindo.`;
    }
    return paused
      ? `${person} joined. ${agent} is paused and not listening.`
      : `${person} joined. ${agent} is here and listening.`;
  },
  paused: (agent: string, lang: SpokenLanguage) =>
    lang === "pt"
      ? `${agent} parou de ouvir. Ninguém está sendo ouvido até o anfitrião retomar.`
      : `${agent} has stopped listening. Nobody is being listened to until it is resumed.`,
  resumed: (agent: string, lang: SpokenLanguage) =>
    lang === "pt" ? `${agent} está ouvindo de novo.` : `${agent} is listening again.`,
  leaving: (agent: string, lang: SpokenLanguage) =>
    lang === "pt" ? `Ok, ${agent} está saindo da chamada.` : `Okay, ${agent} is leaving the call.`,
};

/** The parts of the room and session the controller drives. Mocked in tests. */
export interface RoomPort {
  say(text: string): void;
  /** Stop or resume feeding anyone's audio to speech recognition. */
  setListening(enabled: boolean): void;
  /** Publish the visible paused flag on the agent's participant. */
  publishPaused(paused: boolean): void;
  /** Send a control message to one participant. */
  sendTo(identity: string, msg: ControlMessage): void;
  /** Leave the room (after the current speech). */
  leave(): void;
  /** Tell the server the room is now agent off (a voice request to leave). */
  agentOff?(): void;
}

export type InviteOutcome = "sent" | "declined" | "no_host" | "no_answer";

export interface RoomControlOptions {
  agentName: string;
  /** Identity (user id) of the host, from the room metadata. */
  hostIdentity?: string;
  getLanguage?: () => SpokenLanguage;
  /** How long to wait for the host app to pick a contact. */
  inviteTimeoutMs?: number;
  newId?: () => string;
}

/**
 * Consent-related room behaviour: announcements, the pause control that stops all
 * listening, the voice requests to stop or leave, and asking the host app to invite
 * someone. Independent of LiveKit so it can be tested with a mock {@link RoomPort}.
 */
export class RoomControl {
  private port: RoomPort | null = null;
  private pausedFlag = false;
  private pausedBy: string | null = null;
  private pending = new Map<string, (o: InviteOutcome) => void>();
  private readonly lang: () => SpokenLanguage;

  constructor(private readonly opts: RoomControlOptions) {
    this.lang = opts.getLanguage ?? (() => "en");
  }

  /** Attach the room and session once they exist (the tools are needed before that). */
  bind(port: RoomPort): void {
    this.port = port;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  /** Say that the agent is here and listening. Call once the session is running. */
  announceEntry(): void {
    this.port?.say(phrases.entry(this.opts.agentName, this.lang()));
  }

  /**
   * The agent restarted in a conversation that was already going: no greeting, just one short
   * apology so the person knows it is back.
   */
  announceResume(): void {
    this.port?.say(phrases.back(this.lang()));
  }

  /** Someone joined after the agent: say so again, so they know it is listening. */
  onParticipantJoined(p: { identity: string; name?: string; isAgent?: boolean }): void {
    if (p.isAgent) return;
    this.port?.say(
      phrases.joined(this.opts.agentName, p.name || p.identity, this.pausedFlag, this.lang()),
    );
  }

  /** A control message from a participant. `sender` is null when LiveKit gave none. */
  onControlMessage(sender: { identity: string } | null, msg: ControlMessage): void {
    if (!sender) return;
    switch (msg.type) {
      case "pause_ai":
        // Anyone can stop the AI listening. Starting again needs the host or whoever paused.
        if (msg.paused) this.pause(sender.identity);
        else if (sender.identity === this.opts.hostIdentity || sender.identity === this.pausedBy) {
          this.resume();
        }
        return;
      case "invite_response":
        // Only the host's app answers invite requests.
        if (sender.identity !== this.opts.hostIdentity) return;
        this.pending.get(msg.requestId)?.(msg.status);
        return;
      default:
        return;
    }
  }

  pause(by: string): void {
    if (this.pausedFlag) return;
    this.pausedFlag = true;
    this.pausedBy = by;
    this.port?.setListening(false);
    this.port?.publishPaused(true);
    this.port?.say(phrases.paused(this.opts.agentName, this.lang()));
  }

  resume(): void {
    if (!this.pausedFlag) return;
    this.pausedFlag = false;
    this.pausedBy = null;
    this.port?.setListening(true);
    this.port?.publishPaused(false);
    this.port?.say(phrases.resumed(this.opts.agentName, this.lang()));
  }

  /** "Stop listening" or "leave" said out loud. */
  stopOrLeave(action: "pause" | "leave"): void {
    if (action === "leave") {
      this.port?.setListening(false);
      this.port?.publishPaused(true);
      this.port?.say(phrases.leaving(this.opts.agentName, this.lang()));
      this.port?.agentOff?.();
      this.port?.leave();
    } else {
      // The host can resume with the control; nobody can by voice, as nothing is listening.
      this.pause("voice");
    }
  }

  /** Ask the host's app to pick the contact for `who` ("my mother") and share an invite. */
  requestInvite(who: string): Promise<InviteOutcome> {
    const host = this.opts.hostIdentity;
    if (!host || !this.port) return Promise.resolve("no_host");
    const requestId = this.opts.newId?.() ?? crypto.randomUUID();
    const timeoutMs = this.opts.inviteTimeoutMs ?? 120_000;
    return new Promise<InviteOutcome>((resolve) => {
      const done = (o: InviteOutcome) => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve(o);
      };
      const timer = setTimeout(() => done("no_answer"), timeoutMs);
      this.pending.set(requestId, done);
      this.port!.sendTo(host, { type: "invite_request", requestId, who });
    });
  }

  /** Tools for the agent: invite someone, stop listening or leave. */
  tools() {
    return {
      invite_participant: llm.tool({
        description:
          "Invite a person to this call when someone asks, for example 'invite my mother'. " +
          "The host's app asks the host to choose the contact and share the link. " +
          "Never say or read out the tool name. Reply with one short sentence.",
        parameters: {
          type: "object",
          properties: {
            who: {
              type: "string",
              description: "How the person was described, e.g. 'my mother' or 'Ana'.",
            },
          },
          required: ["who"],
        },
        execute: async (args) => {
          const outcome = await this.requestInvite(String((args as { who?: unknown }).who ?? ""));
          switch (outcome) {
            case "sent":
              return "The host chose a contact and the invite link was shared.";
            case "declined":
              return "The host cancelled; no invite was sent.";
            case "no_answer":
              return "The host's app did not answer; no invite was sent.";
            default:
              return "Inviting is not available in this call.";
          }
        },
      }),
      stop_listening_or_leave: llm.tool({
        description:
          "Call when anyone asks you to stop listening, pause, stop recording, or leave the call. " +
          "Use action 'pause' to stop listening to everyone but stay, or 'leave' to leave the call. " +
          "Never say or read out the tool name.",
        parameters: {
          type: "object",
          properties: { action: { type: "string", enum: ["pause", "leave"] } },
          required: ["action"],
        },
        execute: async (args) => {
          const action = (args as { action?: unknown }).action === "leave" ? "leave" : "pause";
          this.stopOrLeave(action);
          return action === "leave" ? "Leaving the call." : "Listening is paused.";
        },
      }),
    };
  }
}

/** Host user id from the room metadata JSON the server sets. */
export function hostIdentityFromMetadata(metadata: string | undefined): string | undefined {
  try {
    const id = (JSON.parse(metadata ?? "") as { hostUserId?: unknown }).hostUserId;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Agent name from the room metadata, falling back to the configured one. */
export function agentNameFromMetadata(metadata: string | undefined, fallback: string): string {
  try {
    const n = (JSON.parse(metadata ?? "") as { agentName?: unknown }).agentName;
    return typeof n === "string" && n.trim() ? n.trim() : fallback;
  } catch {
    return fallback;
  }
}
