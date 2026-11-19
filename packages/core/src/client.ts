import { Room, RoomEvent, ConnectionState, type Participant } from "livekit-client";
import { connectMcpServer, type ConnectMcpServerOptions } from "./mcp.js";
import {
  OpenBlahApi,
  type McpConnection,
  type AgentBringInResult,
  type AgentControlState,
  type ConsentGrant,
  type ConsentStatus,
  type CreateInviteOptions,
  type Invite,
  type InvitePreview,
  type OpenBlahApiOptions,
  type RoomParticipant,
} from "./api.js";
import {
  AI_PAUSED_ATTRIBUTE,
  MODE_ATTRIBUTE,
  CONTROL_TOPIC,
  encodeControlMessage,
  parseControlMessage,
  roleFromMetadata,
  type ControlMessage,
  type InviteRequestMessage,
  type Role,
  type RoomMode,
} from "./protocol.js";

/**
 * State of the agent as shown to the user. `muted` is the local user's mic state
 * and wins over the agent's own state, so a UI can show one indicator. `paused`
 * means someone paused the AI: it is not listening to anyone.
 */
export type AgentState = "listening" | "thinking" | "speaking" | "muted" | "paused" | "unavailable";

/** Connection state of the client. */
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

/** A participant in the room, reduced to what a UI needs. */
export interface ParticipantInfo {
  identity: string;
  name: string;
  isLocal: boolean;
  isAgent: boolean;
  /** From the token the server issued. The agent has no role and shows as `guest`; check `isAgent`. */
  role: Role;
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

/** Data topic the agent publishes approval requests on, and the owner's answer goes back on. @internal */
export const APPROVAL_TOPIC = "openblah.approval";
/** Wire-level detail. @internal */
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
  /** True while the AI is paused: it listens to nobody. Show this to everyone. */
  aiPaused: boolean;
  /** The agent's mode (Listening, Facilitating, Direct); `listening` until the agent says otherwise. */
  mode: RoomMode;
  /** Room id and your user id, once connected. */
  roomId: string | null;
  userId: string | null;
  /** Your role in the room, or null when not connected. */
  role: Role | null;
  /**
   * The room metadata the server mirrors (agent setting, pending requests). It changes when the
   * agent is brought in or sent out, which is when agent controls should reload.
   */
  roomMetadata: string | null;
  error: string | null;
}

/** Events emitted by {@link OpenBlahClient}. */
export interface ClientEvents {
  /** Fired on any change; read the new value with `getSnapshot()`. */
  change: ClientSnapshot;
  connected: void;
  disconnected: void;
  error: Error;
  /**
   * The agent was asked to invite someone ("Blah, invite my mother") and needs the
   * host app to pick the contact. Only fires for the host. Show a contact picker or
   * share sheet, then call `respondToInviteRequest`.
   */
  inviteRequest: InviteRequestMessage;
}

/** Attribute the LiveKit agent publishes its state under. @internal */
export const AGENT_STATE_ATTRIBUTE = "lk.agent.state";

/**
 * Derive the agent state from the agent participant's attributes.
 * Stubbed until the agent exists: no agent participant gives `unavailable`.
 * @internal
 */
export function deriveAgentState(
  agent: { attributes: Record<string, string> } | undefined,
  muted: boolean,
): AgentState {
  if (muted) return "muted";
  if (!agent) return "unavailable";
  if (agent.attributes[AI_PAUSED_ATTRIBUTE] === "true") return "paused";
  switch (agent.attributes[AGENT_STATE_ATTRIBUTE]) {
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    default:
      return "listening";
  }
}

/** The part of the LiveKit `Room` the client uses. Lets tests pass a fake. @internal */
export type RoomLike = Pick<
  Room,
  | "connect"
  | "disconnect"
  | "on"
  | "off"
  | "localParticipant"
  | "remoteParticipants"
  | "state"
  | "name"
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
  /**
   * The OpenBlah server, for invites, consent and host controls. Pass options, or a
   * ready {@link OpenBlahApi}. Without it those methods throw.
   */
  api?: OpenBlahApi | OpenBlahApiOptions;
  /** LiveKit URL to use when joining by invite and the server does not return one. */
  livekitUrl?: string;
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
  RoomEvent.RoomMetadataChanged,
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
  private readonly api?: OpenBlahApi;
  private readonly livekitUrl?: string;
  private listeners = new Map<keyof ClientEvents, Set<Listener<never>>>();
  private snapshot: ClientSnapshot = {
    status: "disconnected",
    participants: [],
    muted: true,
    agentState: "unavailable",
    approvals: [],
    aiPaused: false,
    mode: "listening",
    roomId: null,
    userId: null,
    role: null,
    roomMetadata: null,
    error: null,
  };
  private readonly onRoomEvent = () => this.refresh();
  private readonly onData = (
    payload: Uint8Array,
    participant?: Participant,
    _kind?: unknown,
    topic?: string,
  ) => {
    this.handleData(payload, participant, topic);
    if (topic !== CONTROL_TOPIC) return;
    const msg = parseControlMessage(payload);
    // Only the agent may ask the host to invite someone; a guest must not be able to fake it.
    if (msg?.type === "invite_request" && participant?.isAgent && this.snapshot.role === "host") {
      this.emit("inviteRequest", msg);
    }
  };

  constructor(options: OpenBlahClientOptions = {}) {
    this.beforeConnect = options.beforeConnect;
    this.afterDisconnect = options.afterDisconnect;
    this.livekitUrl = options.livekitUrl;
    if (options.api) {
      this.api = options.api instanceof OpenBlahApi ? options.api : new OpenBlahApi(options.api);
    }
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
      aiPaused: false,
      mode: "listening",
      roomId: null,
      userId: null,
      role: null,
      roomMetadata: null,
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

  // ---- Invites, consent and host controls (T11) ----

  /**
   * Join a room from an invite link as a guest and connect. `consent` is what the
   * guest agreed to: show them {@link getInvitePreview}'s `consent.text` first and pass
   * its `version` as `textVersion`. Pass `null` only when the room's AI is off (the server
   * refuses otherwise). Rejects with `OpenBlahApiError` (404 for any
   * invalid, expired or used-up invite).
   */
  async joinWithInvite(
    token: string,
    displayName: string,
    consent: ConsentGrant | null,
  ): Promise<void> {
    const join = await this.requireApi().joinWithInvite(token, displayName, consent);
    const url = join.livekitUrl ?? this.livekitUrl;
    if (!url)
      throw new Error("No LiveKit URL: the server sent none and no livekitUrl option is set");
    await this.connect(url, join.token);
  }

  /** What a guest should see before joining: host name, agent name and the consent text. */
  async getInvitePreview(token: string): Promise<InvitePreview> {
    return this.requireApi().getInvite(token);
  }

  /** Host: create an invite link for this room (for example to copy or share). */
  async createInvite(options?: CreateInviteOptions): Promise<Invite> {
    const { roomId, userId } = this.requireSession();
    return this.requireApi().createInvite(roomId, userId, options);
  }

  /** Host: make an invite link stop working. */
  async revokeInvite(inviteId: string): Promise<void> {
    const { roomId, userId } = this.requireSession();
    await this.requireApi().revokeInvite(roomId, inviteId, userId);
  }

  /** Host: remove someone from the room. */
  async removeParticipant(userId: string): Promise<void> {
    const s = this.requireSession();
    await this.requireApi().removeParticipant(s.roomId, userId, s.userId);
  }

  /** Host: end the room for everyone. */
  async endRoom(): Promise<void> {
    const { roomId, userId } = this.requireSession();
    await this.requireApi().endRoom(roomId, userId);
  }

  /** Everyone in the room per the server (guests do not see contact details). */
  async listParticipants(): Promise<RoomParticipant[]> {
    const { roomId, userId } = this.requireSession();
    return this.requireApi().listParticipants(roomId, userId);
  }

  /** The consent text for this room and who has not consented yet. */
  async getConsent(): Promise<ConsentStatus> {
    const { roomId, userId } = this.requireSession();
    return this.requireApi().getConsent(roomId, userId);
  }

  /** Record that you accept the consent text (`version` from {@link getConsent}). */
  async giveConsent(version: string): Promise<void> {
    const { roomId, userId } = this.requireSession();
    await this.requireApi().giveConsent(roomId, userId, version);
  }

  // ---- Optional agent per room (T18) ----

  /** The room's agent setting, pending requests and who still has to consent. */
  async getAgentState(): Promise<AgentControlState> {
    const { roomId, userId } = this.requireSession();
    return this.requireApi().getAgentState(roomId, userId);
  }

  /**
   * Bring the agent in. The host (or anyone, when the room allows it) turns it on: everyone is then
   * asked for consent again and the agent listens only when all have agreed. Anyone else sends a
   * request the host approves.
   */
  async bringInAgent(): Promise<AgentBringInResult> {
    const { roomId, userId } = this.requireSession();
    return this.requireApi().bringInAgent(roomId, userId);
  }

  /** Send the agent out: it leaves and nothing is listened to. Host, or anyone if the room allows. */
  async sendOutAgent(): Promise<void> {
    const { roomId, userId } = this.requireSession();
    await this.requireApi().sendOutAgent(roomId, userId);
  }

  /** Host: approve or decline a request to bring the agent in. */
  async answerAgentRequest(requestId: string, approve: boolean): Promise<void> {
    const { roomId, userId } = this.requireSession();
    await this.requireApi().answerAgentRequest(roomId, requestId, userId, approve);
  }

  /** Host: "anyone can add the agent" and the idle timeout in seconds. */
  async updateAgentSettings(settings: {
    anyoneCanAddAgent?: boolean;
    idleTimeoutSeconds?: number | null;
  }): Promise<void> {
    const { roomId, userId } = this.requireSession();
    await this.requireApi().updateAgentSettings(roomId, userId, settings);
  }

  /**
   * Pause or resume the AI for everyone. While paused the agent listens to nobody and
   * `aiPaused` is true in every client. Anyone can pause; only the host or the person
   * who paused can resume. Resolves when the request is sent; the state changes when
   * the agent confirms it.
   */
  async setAiPaused(paused: boolean): Promise<void> {
    await this.sendControl({ type: "pause_ai", paused });
  }

  /** Switch the agent's mode. Direct is host only (the agent ignores it from anyone else). */
  async setMode(mode: RoomMode): Promise<void> {
    await this.sendControl({ type: "set_mode", mode });
  }

  /** Host: tell the agent what happened to an `inviteRequest` ("sent" once a link was shared). */
  async respondToInviteRequest(requestId: string, status: "sent" | "declined"): Promise<void> {
    await this.sendControl({ type: "invite_response", requestId, status });
  }

  private async sendControl(msg: ControlMessage): Promise<void> {
    if (!this.room) throw new Error("Not connected");
    await this.room.localParticipant.publishData(encodeControlMessage(msg), {
      reliable: true,
      topic: CONTROL_TOPIC,
    });
  }

  // ---- MCP servers (OAuth connect) ----

  /**
   * Connect one of the person's MCP servers: runs the OAuth sign-in through
   * `openAuthorization` and resolves once it is connected. Works before or during a call.
   * Voice never carries credentials.
   */
  connectMcpServer(url: string, options: ConnectMcpServerOptions): Promise<McpConnection> {
    return connectMcpServer(this.requireApi(), url, options);
  }

  listMcpServers(userId?: string): Promise<McpConnection[]> {
    return this.requireApi().listMcpConnections(userId);
  }

  testMcpServer(id: string, userId?: string) {
    return this.requireApi().testMcpConnection(id, userId);
  }

  /** Disconnect a server; its stored tokens are deleted. */
  disconnectMcpServer(id: string, userId?: string): Promise<void> {
    return this.requireApi().disconnectMcp(id, userId);
  }

  private requireApi(): OpenBlahApi {
    if (!this.api) throw new Error("Pass `api` to OpenBlahClient to use invites and consent");
    return this.api;
  }

  private requireSession(): { roomId: string; userId: string } {
    const { roomId, userId } = this.snapshot;
    if (!roomId || !userId) throw new Error("Not connected");
    return { roomId, userId };
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
      aiPaused: agent?.attributes[AI_PAUSED_ATTRIBUTE] === "true",
      mode: modeFromAttribute(agent?.attributes[MODE_ATTRIBUTE]),
      roomId: room.name,
      userId: local.identity,
      role: roleFromMetadata(local.metadata),
      roomMetadata: (room as { metadata?: string }).metadata ?? null,
    });
  }
}

function modeFromAttribute(v: string | undefined): RoomMode {
  return v === "direct" || v === "facilitating" ? v : "listening";
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
    role: roleFromMetadata(p.metadata),
    isSpeaking: p.isSpeaking,
    isMuted: !p.isMicrophoneEnabled,
  };
}
