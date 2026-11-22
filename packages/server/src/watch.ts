import { SignJWT, jwtVerify } from "jose";

/**
 * The tiny watch protocol (docs/watch-protocol.md), spike T27.
 * Text frames are JSON; audio travels as binary frames (16 kHz mono 16-bit PCM, little endian).
 * All logic lives on the server: the watch only records, plays and shows state.
 */
export const WATCH_PROTOCOL_VERSION = 1;
export const WATCH_AUDIO_SAMPLE_RATE = 16000;

export type AgentState = "idle" | "listening" | "thinking" | "speaking";
const AGENT_STATES: readonly AgentState[] = ["idle", "listening", "thinking", "speaking"];

/** Watch to server. */
export type WatchClientMessage =
  | { type: "start"; version: number; ticket: string }
  | { type: "stop" }
  | { type: "mute"; muted: boolean };

/** Server to watch. */
export type WatchServerMessage =
  | { type: "started"; roomId: string; agentName: string }
  | { type: "stopped"; reason: "client" | "room-ended" | "idle" | "error" }
  | { type: "muted"; muted: boolean }
  | { type: "agent_state"; state: AgentState }
  | { type: "transcript"; speaker: string; text: string; final: boolean }
  | { type: "error"; code: "bad_message" | "unauthorized" | "unsupported"; message: string };

export function isAgentState(v: unknown): v is AgentState {
  return typeof v === "string" && (AGENT_STATES as readonly string[]).includes(v);
}

/** Parse a text frame from the watch. Returns null when it is not a valid message. */
export function parseClientMessage(raw: string): WatchClientMessage | null {
  if (raw.length > 4096) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const m = v as Record<string, unknown>;
  if (m.type === "start") {
    return typeof m.version === "number" && typeof m.ticket === "string" && m.ticket
      ? { type: "start", version: m.version, ticket: m.ticket }
      : null;
  }
  if (m.type === "stop") return { type: "stop" };
  if (m.type === "mute")
    return typeof m.muted === "boolean" ? { type: "mute", muted: m.muted } : null;
  return null;
}

/** A short-lived pass to open one watch socket for one room. Minted over HTTP with the user's sign-in. */
export interface WatchTicketClaims {
  uid: string;
  roomId: string;
  displayName: string;
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function signWatchTicket(
  secret: string,
  claims: WatchTicketClaims,
  ttlSeconds = 60,
): Promise<string> {
  return new SignJWT({ roomId: claims.roomId, name: claims.displayName })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.uid)
    .setAudience("openblah-watch")
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(enc(secret));
}

export async function verifyWatchTicket(
  secret: string,
  ticket: string,
): Promise<WatchTicketClaims | null> {
  try {
    const { payload } = await jwtVerify(ticket, enc(secret), {
      audience: "openblah-watch",
      algorithms: ["HS256"],
    });
    if (!payload.sub || typeof payload.roomId !== "string") return null;
    return {
      uid: payload.sub,
      roomId: payload.roomId,
      displayName: typeof payload.name === "string" ? payload.name : "Watch",
    };
  } catch {
    return null;
  }
}

/**
 * The server's seat in the room for one watch: joins as a participant, publishes the watch's
 * microphone audio and delivers the agent's audio, state and transcript. The real implementation
 * (LiveKit's server-side RTC client) is the open piece of the spike; see docs/spike-apple-watch.md.
 */
export interface RoomLink {
  publishAudio(pcm: Uint8Array): void;
  setMuted(muted: boolean): void;
  close(): Promise<void>;
}
export interface RoomLinkHandlers {
  onAudio(pcm: Uint8Array): void;
  onAgentState(state: AgentState): void;
  onTranscript(speaker: string, text: string, final: boolean): void;
  onRoomEnded(): void;
}
export type RoomLinkFactory = (
  claims: WatchTicketClaims,
  handlers: RoomLinkHandlers,
) => Promise<RoomLink>;

/** What the transport (a WebSocket) gives a session. */
export interface WatchTransport {
  sendText(msg: WatchServerMessage): void;
  sendAudio(pcm: Uint8Array): void;
  close(): void;
}

/** One watch connection. The transport feeds it frames; it talks to the room through the link. */
export class WatchSession {
  private link: RoomLink | null = null;
  private starting = false;
  private ended = false;

  constructor(
    private readonly transport: WatchTransport,
    private readonly secret: string,
    private readonly connect: RoomLinkFactory,
    private readonly agentName: (roomId: string) => Promise<string>,
  ) {}

  async onText(raw: string): Promise<void> {
    const msg = parseClientMessage(raw);
    if (!msg) return this.fail("bad_message", "Unrecognised message");
    if (msg.type === "start") return this.start(msg);
    if (!this.link) return this.fail("bad_message", "Send start first");
    if (msg.type === "mute") {
      this.link.setMuted(msg.muted);
      this.transport.sendText({ type: "muted", muted: msg.muted });
    } else await this.end("client");
  }

  onAudio(pcm: Uint8Array): void {
    this.link?.publishAudio(pcm);
  }

  /** The socket dropped: leave the room. */
  async onClose(): Promise<void> {
    await this.end(null);
  }

  private async start(msg: Extract<WatchClientMessage, { type: "start" }>): Promise<void> {
    if (this.link || this.starting) return this.fail("bad_message", "Already started");
    if (msg.version !== WATCH_PROTOCOL_VERSION)
      return this.fail("unsupported", `Protocol version ${WATCH_PROTOCOL_VERSION} only`);
    const claims = await verifyWatchTicket(this.secret, msg.ticket);
    if (!claims) return this.fail("unauthorized", "Ticket is invalid or expired");
    this.starting = true;
    try {
      const link = await this.connect(claims, {
        onAudio: (pcm) => this.transport.sendAudio(pcm),
        onAgentState: (state) => this.transport.sendText({ type: "agent_state", state }),
        onTranscript: (speaker, text, final) =>
          this.transport.sendText({ type: "transcript", speaker, text, final }),
        onRoomEnded: () => void this.end("room-ended"),
      });
      if (this.ended) return void (await link.close());
      this.link = link;
      this.transport.sendText({
        type: "started",
        roomId: claims.roomId,
        agentName: await this.agentName(claims.roomId),
      });
    } catch {
      await this.end("error");
    } finally {
      this.starting = false;
    }
  }

  private fail(code: "bad_message" | "unauthorized" | "unsupported", message: string): void {
    this.transport.sendText({ type: "error", code, message });
    if (code !== "bad_message") this.transport.close();
  }

  private async end(reason: "client" | "room-ended" | "idle" | "error" | null): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    const link = this.link;
    this.link = null;
    if (reason) {
      this.transport.sendText({ type: "stopped", reason });
      this.transport.close();
    }
    await link?.close();
  }
}
