export type AgentMode = "on" | "off" | "ask";

export interface Room {
  id: string;
  hostUserId: string;
  hostDisplayName: string;
  agent: AgentMode;
  sensitive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Storage for room metadata (later also invites and history). */
export interface Storage {
  createRoom(room: Room): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
}

export interface TokenRequest {
  roomId: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  ttlSeconds: number;
}

/** The parts of LiveKit the server needs. Mocked in tests. */
export interface LiveKitGateway {
  /** Create the LiveKit room with metadata mirrored from the stored room. */
  createRoom(roomId: string, metadata: string): Promise<void>;
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
