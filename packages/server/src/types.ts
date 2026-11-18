import type { UserRecord } from "./accounts.js";
import type { KeyProvider, StoredKey } from "./keys.js";
import type { SettingsLevel } from "./settings.js";
import type { McpConnectionRecord } from "./mcp-oauth.js";
import type { CallHistory } from "./history.js";

export type AgentMode = "on" | "off" | "ask";
/** host and member are app users; guest joined through an invite link. */
export type Role = "host" | "member" | "guest";

export interface Room {
  id: string;
  hostUserId: string;
  hostDisplayName: string;
  agent: AgentMode;
  /** Name the agent goes by in consent text and announcements (Q1). */
  agentName: string;
  sensitive: boolean;
  metadata: Record<string, unknown>;
  /** MCP servers for the agent. Server-side only: holds user tokens, never sent to clients. */
  mcp?: Record<string, unknown>;
  /** Room-level model and language (the top level of the three, T17). */
  settings?: SettingsLevel;
  createdAt: string;
  /** Server-only: id of the API key that created the room (picks product keys). Never returned. */
  productKeyId?: string;

  /** Lowers the server's max agent session length for this room, in seconds. */
  maxDurationSeconds?: number;
  /** Lowers the server's idle timeout for this room, in seconds. */
  idleTimeoutSeconds?: number;

  /** Host turned "save notes" on: the transcript, notes and summary are kept (T19). Default off. */
  saveNotes?: boolean;
  /** How long saved history is kept (Q4). Default "30d". */
  retention?: "30d" | "1y" | "forever";

  /** Set when the host ends the room; no more tokens or invites. */
  endedAt?: string;
}

/** Only a hash of the invite token is stored. */
export interface Invite {
  id: string;
  roomId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
}

export interface Participant {
  roomId: string;
  userId: string;
  displayName: string;
  role: Role;
  /** Contact detail (email, phone). Never shown to guests. */
  contact?: string;
  joinedAt: string;
  removedAt?: string;
}

export interface ConsentRecord {
  roomId: string;
  userId: string;
  textVersion: string;
  consentedAt: string;
}

/** Storage for rooms, invites, participants and consent (later also history). */
/** Post-call summary written by the agent when the call ends (T9). Full history screens come in T19. */
export interface CallSummary {
  roomId: string;
  /** Language of `text`: the room's language. */
  language: "en" | "pt";
  text: string;
  notes: string[];
  actions: Array<{ text: string; owner?: string; done: boolean }>;
  participants: string[];
  createdAt: string;
}

export interface Storage {
  createRoom(room: Room): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
  /** Saved BYOK keys (encrypted). */
  putKey(key: StoredKey): Promise<void>;
  deleteKey(ownerId: string, provider: KeyProvider): Promise<boolean>;
  listKeys(ownerId: string): Promise<StoredKey[]>;
  /** MCP OAuth connections (tokens sealed). Callers check `ownerId`. */
  putMcpConnection(rec: McpConnectionRecord): Promise<void>;
  getMcpConnection(id: string): Promise<McpConnectionRecord | null>;
  listMcpConnections(ownerId: string): Promise<McpConnectionRecord[]>;
  deleteMcpConnection(id: string): Promise<void>;
  /** Minimal user records for the standalone app. */
  upsertUser(user: UserRecord): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  /** Settings saved at the user or product level, keyed by scope id (`user:<id>`, `product:<id>`). */
  getSettings(scopeId: string): Promise<SettingsLevel | null>;
  putSettings(scopeId: string, settings: SettingsLevel): Promise<void>;
  /** Trial usage counters (seconds), keyed by scope id. */
  getUsage(counterId: string): Promise<number>;
  /** Atomically add seconds; returns the new total. */
  addUsage(counterId: string, seconds: number): Promise<number>;
  /** All counters whose id starts with `prefix`, by id (the usage log). */
  listUsage(prefix: string): Promise<Record<string, number>>;

  updateRoom(room: Room): Promise<void>;

  createInvite(invite: Invite): Promise<void>;
  getInvite(id: string): Promise<Invite | null>;
  getInviteByTokenHash(tokenHash: string): Promise<Invite | null>;
  /**
   * Atomically use one invite slot. Returns the updated invite, or null when
   * the invite is revoked, expired or out of uses.
   */
  consumeInvite(id: string, now: Date): Promise<Invite | null>;
  revokeInvite(id: string): Promise<void>;

  saveParticipant(p: Participant): Promise<void>;
  getParticipant(roomId: string, userId: string): Promise<Participant | null>;
  listParticipants(roomId: string): Promise<Participant[]>;

  saveConsent(c: ConsentRecord): Promise<void>;
  listConsents(roomId: string): Promise<ConsentRecord[]>;

  /** One summary per room; saving again replaces it. */
  saveSummary(summary: CallSummary): Promise<void>;
  getSummary(roomId: string): Promise<CallSummary | null>;
  deleteSummary(roomId: string): Promise<void>;

  /** Call history (T19): one per room; saving again replaces it. */
  saveHistory(history: CallHistory): Promise<void>;
  getHistory(roomId: string): Promise<CallHistory | null>;
  /** Histories of calls these room ids. Used to list a person's calls. */
  listHistories(roomIds: string[]): Promise<CallHistory[]>;
  /** Every stored history (cleanup job). */
  listAllHistories(): Promise<CallHistory[]>;
  deleteHistory(roomId: string): Promise<void>;
  /** Rooms a user took part in (host or participant, not guests). */
  listRoomIdsForUser(userId: string): Promise<string[]>;
}

export interface TokenRequest {
  roomId: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  role: Role;
  ttlSeconds: number;
}

/** The parts of LiveKit the server needs. Mocked in tests. */
export interface LiveKitGateway {
  /** Create the LiveKit room with metadata mirrored from the stored room. */
  createRoom(roomId: string, metadata: string): Promise<void>;
  updateRoomMetadata(roomId: string, metadata: string): Promise<void>;
  deleteRoom(roomId: string): Promise<void>;
  removeParticipant(roomId: string, userId: string): Promise<void>;
  /**
   * Send a data message from the server to the agent in the room. The agent
   * only trusts the tool-approval topic when it comes from the server.
   */
  sendData(roomId: string, topic: string, payload: string): Promise<void>;
  /** Mint a short-lived join token. */
  createToken(req: TokenRequest): Promise<string>;
  /**
   * Dispatch the agent worker into the room. Idempotent: if the agent is
   * already dispatched there, no second one is created.
   */
  dispatchAgent(
    roomId: string,
    metadata: string,
  ): Promise<{ dispatchId: string; created: boolean }>;
}

/**
 * Wakes the agent worker (a Cloud Run service with min instances 0) so it is
 * registered with LiveKit by the time a dispatch arrives. No STT/LLM/TTS calls.
 */
export interface WorkerWaker {
  /** Resolves true when the worker answered, false when it is not configured or unreachable. */
  wake(): Promise<boolean>;
}
