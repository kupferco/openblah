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
  createdAt: string;
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
export interface Storage {
  createRoom(room: Room): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
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
