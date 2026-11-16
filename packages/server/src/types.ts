import type { UserRecord } from "./accounts.js";
import type { Provider, StoredKey } from "./keys.js";

export type AgentMode = "on" | "off" | "ask";

export interface Room {
  id: string;
  hostUserId: string;
  hostDisplayName: string;
  agent: AgentMode;
  sensitive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  /** Server-only: id of the API key that created the room (picks product keys). Never returned. */
  productKeyId?: string;
}

/** Storage for room metadata (later also invites and history). */
export interface Storage {
  createRoom(room: Room): Promise<void>;
  getRoom(id: string): Promise<Room | null>;
  /** Saved BYOK keys (encrypted). */
  putKey(key: StoredKey): Promise<void>;
  deleteKey(ownerId: string, provider: Provider): Promise<boolean>;
  listKeys(ownerId: string): Promise<StoredKey[]>;
  /** Minimal user records for the standalone app. */
  upsertUser(user: UserRecord): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  /** Trial usage counters (seconds), keyed by scope id. */
  getUsage(counterId: string): Promise<number>;
  /** Atomically add seconds; returns the new total. */
  addUsage(counterId: string, seconds: number): Promise<number>;
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
