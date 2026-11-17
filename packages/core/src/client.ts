import { Room, RoomEvent, ConnectionState, type Participant } from "livekit-client";

/**
 * State of the agent as shown to the user. `muted` is the local user's mic state
 * and wins over the agent's own state, so a UI can show one indicator.
 */
export type AgentState = "listening" | "thinking" | "speaking" | "muted" | "unavailable";

/** Connection state of the client. */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

/** A participant in the room, reduced to what a UI needs. */
export interface ParticipantInfo {
  identity: string;
  name: string;
  isLocal: boolean;
  isAgent: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
}

/** A write action the agent is waiting to run until its owner confirms. */
export interface ToolApproval {
  id: string;
  /** Short label of what will run, e.g. "book table". */
  tool: string;
  /** What the agent will do, with the details. Show this to the person. */
  summary: string;
  /** Participant who owns the credentials. Only they can confirm. */
  ownerId: string;
  /** ISO time after which it lapses. */
  expiresAt: string;
}

/** Data topic the agent publishes approval requests on, and the owner's answer goes back on. */
export const APPROVAL_TOPIC = "openblah.approval";
export const APPROVAL_RESPONSE_TOPIC = "openblah.approval.response";

/** Everything a UI needs, as one immutable snapshot. */
export interface ClientSnapshot {
  status: ConnectionStatus;
  participants: ParticipantInfo[];
  /** True when the local microphone is off. */
  muted: boolean;
  /** The agent's state, or `unavailable` when no agent is in the room. */
  agentState: AgentState;
  /** Write actions waiting for confirmation. Empty unless you own the tool credentials. */
  approvals: ToolApproval[];
  error: string | null;
}

/** Events emitted by {@link OpenBlahClient}. */
export interface ClientEvents {
  /** Fired on any change; read the new value with `getSnapshot()`. */
  change: ClientSnapshot;
  connected: void;
  disconnected: void;
  error: Error;
}

/** Attribute the LiveKit agent publishes its state under. */
export const AGENT_STATE_ATTRIBUTE = "lk.agent.state";

/**
 * Derive the agent state from the agent participant's attributes.
 * Stubbed until the agent exists: no agent participant gives `unavailable`.
 */
export function deriveAgentState(
  agent: { attributes: Record<string, string> } | undefined,
  muted: boolean,
): AgentState {
  if (muted) return "muted";
  if (!agent) return "unavailable";
  switch (agent.attributes[AGENT_STATE_ATTRIBUTE]) {
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    default:
      return "listening";
  }
}

/** The part of the LiveKit `Room` the client uses. Lets tests pass a fake. */
export type RoomLike = Pick<
  Room,
  "connect" | "disconnect" | "on" | "off" | "localParticipant" | "remoteParticipants" | "state"
>;

/** Options for {@link OpenBlahClient}. */
export interface OpenBlahClientOptions {
  /** Create the LiveKit room. Defaults to `new Room()`; mainly for tests. */
  createRoom?: () => RoomLike;
  /**
   * Runs before the room connects (e.g. start the native audio session on React Native).
   * If it throws, the connection is not attempted.
   */
  beforeConnect?: () => Promise<void>;
  /** Runs after the room is left, on disconnect or a failed connect. Errors are ignored. */
  afterDisconnect?: () => Promise<void>;
}

type Listener<T> = (payload: T) => void;

const ROOM_EVENTS = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.ParticipantAttributesChanged,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ConnectionStateChanged,
  RoomEvent.Reconnecting,
  RoomEvent.Reconnected,
] as const;

/**
 * Vanilla JS client for one OpenBlah voice room. Framework-free; the React hooks wrap it.
 *
 * @remarks 0.x: the API may change between minor versions.
 */
export class OpenBlahClient {
  private room: RoomLike | null = null;
  private readonly createRoom: () => RoomLike;
  private readonly beforeConnect?: () => Promise<void>;
  private readonly afterDisconnect?: () => Promise<void>;
  private listeners = new Map<keyof ClientEvents, Set<Listener<never>>>();
  private snapshot: ClientSnapshot = {
    status: "disconnected",
    participants: [],
    muted: true,
    agentState: "unavailable",
    approvals: [],
    error: null,
  };
  private readonly onRoomEvent = () => this.refresh();
  private readonly onData = (
    payload: Uint8Array,
    participant?: Participant,
    _kind?: unknown,
    topic?: string,
  ) => this.handleData(payload, participant, topic);

  constructor(options: OpenBlahClientOptions = {}) {
    this.beforeConnect = options.beforeConnect;
    this.afterDisconnect = options.afterDisconnect;
    this.createRoom =
      options.createRoom ?? (() => new Room({ adaptiveStream: true, dynacast: true }));
  }

  /** Current state. The object is replaced (never mutated) on every change. */
  getSnapshot(): ClientSnapshot {
    return this.snapshot;
  }

  /**
   * Join a room and publish the microphone.
   * @param serverUrl LiveKit WebSocket URL (`wss://...`), as returned with the token by the OpenBlah server.
   * @param token Join token from `POST /v1/tokens`.
   */
  async connect(serverUrl: string, token: string): Promise<void> {
    if (this.room) await this.disconnect();
    this.update({ status: "connecting", error: null });
    let room: RoomLike | null = null;
    try {
      await this.beforeConnect?.();
      room = this.createRoom();
      this.room = room;
      for (const e of ROOM_EVENTS) room.on(e, this.onRoomEvent);
      room.on(RoomEvent.DataReceived, this.onData);
      await room.connect(serverUrl, token);
      await room.localParticipant.setMicrophoneEnabled(true);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.teardown();
      await room?.disconnect().catch(() => undefined);
      await this.runAfterDisconnect();
      this.update({ status: "disconnected", error: error.message });
      this.emit("error", error);
      throw error;
    }
    this.refresh();
    this.emit("connected", undefined);
  }

  /** Leave the room. Safe to call when not connected. */
  async disconnect(): Promise<void> {
    const room = this.room;
    if (!room) return;
    this.teardown();
    await room.disconnect();
    await this.runAfterDisconnect();
    this.update({
      status: "disconnected",
      participants: [],
      muted: true,
      agentState: "unavailable",
      approvals: [],
    });
    this.emit("disconnected", undefined);
  }

  /** Turn the microphone on or off. */
  async setMuted(muted: boolean): Promise<void> {
    if (!this.room) return;
    await this.room.localParticipant.setMicrophoneEnabled(!muted);
    this.refresh();
  }

  /** Flip the microphone. Returns the new muted value. */
  async toggleMute(): Promise<boolean> {
    const next = !this.snapshot.muted;
    await this.setMuted(next);
    return next;
  }

  /**
   * Confirm (`approve: true`) or cancel a pending write action. Only the owner
   * of the tool credentials is accepted; the agent checks who sent it.
   */
  async respondToApproval(id: string, approve: boolean): Promise<void> {
    const room = this.room;
    if (!room) return;
    const agent = [...room.remoteParticipants.values()].find((p) => p.isAgent);
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ approvalId: id, approve })),
      {
        reliable: true,
        topic: APPROVAL_RESPONSE_TOPIC,
        ...(agent ? { destinationIdentities: [agent.identity] } : {}),
      },
    );
    this.update({ approvals: this.snapshot.approvals.filter((a) => a.id !== id) });
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof ClientEvents>(event: K, listener: Listener<ClientEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener as Listener<never>);
    return () => void set.delete(listener as Listener<never>);
  }

  private async runAfterDisconnect(): Promise<void> {
    try {
      await this.afterDisconnect?.();
    } catch {
      // Cleanup must not fail a disconnect.
    }
  }

  /** Only the agent's messages count; the agent decides who may see a request. */
  private handleData(payload: Uint8Array, participant: Participant | undefined, topic?: string) {
    if (topic !== APPROVAL_TOPIC || !participant?.isAgent) return;
    let msg: { type?: string; id?: unknown } & Partial<ToolApproval>;
    try {
      msg = JSON.parse(new TextDecoder().decode(payload));
    } catch {
      return;
    }
    if (typeof msg.id !== "string") return;
    const id = msg.id;
    if (msg.type === "resolved") {
      this.update({ approvals: this.snapshot.approvals.filter((a) => a.id !== id) });
      return;
    }
    const me = this.room?.localParticipant.identity;
    // Show the card only to the owner; anyone else cannot confirm anyway.
    if (msg.type !== "request" || msg.ownerId !== me) return;
    if (typeof msg.tool !== "string" || typeof msg.summary !== "string") return;
    const approval: ToolApproval = {
      id,
      tool: msg.tool,
      summary: msg.summary,
      ownerId: msg.ownerId ?? "",
      expiresAt: typeof msg.expiresAt === "string" ? msg.expiresAt : "",
    };
    this.update({
      approvals: [...this.snapshot.approvals.filter((a) => a.id !== id), approval],
    });
  }

  private teardown(): void {
    if (!this.room) return;
    for (const e of ROOM_EVENTS) this.room.off(e, this.onRoomEvent);
    this.room.off(RoomEvent.DataReceived, this.onData);
    this.room = null;
  }

  private emit<K extends keyof ClientEvents>(event: K, payload: ClientEvents[K]): void {
    this.listeners.get(event)?.forEach((l) => (l as Listener<ClientEvents[K]>)(payload));
  }

  private update(patch: Partial<ClientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit("change", this.snapshot);
  }

  private refresh(): void {
    const room = this.room;
    if (!room) return;
    const local = room.localParticipant;
    const all: Participant[] = [local, ...room.remoteParticipants.values()];
    const participants = all.map(toInfo);
    const agent = [...room.remoteParticipants.values()].find((p) => p.isAgent);
    const muted = !local.isMicrophoneEnabled;
    this.update({
      status: toStatus(room.state),
      participants,
      muted,
      agentState: deriveAgentState(agent, muted),
    });
  }
}

function toStatus(state: ConnectionState): ConnectionStatus {
  switch (state) {
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Connecting:
      return "connecting";
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    default:
      return "disconnected";
  }
}

function toInfo(p: Participant): ParticipantInfo {
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal: p.isLocal,
    isAgent: p.isAgent,
    isSpeaking: p.isSpeaking,
    isMuted: !p.isMicrophoneEnabled,
  };
}
