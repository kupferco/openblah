import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import type { VideoGrant } from "livekit-server-sdk";
import type { LiveKitGateway, Role, TokenRequest } from "./types.js";

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Name the agent worker registers under. */
  agentWorkerName?: string;
}

/**
 * Grants per role. Nobody may change their own metadata (it carries the role),
 * and only the host gets admin rights. Guests have no admin or recording rights.
 */
export function grantsFor(role: Role, roomId: string): VideoGrant {
  return {
    room: roomId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canUpdateOwnMetadata: false,
    roomAdmin: role === "host",
    roomRecord: false,
  };
}

export class RealLiveKit implements LiveKitGateway {
  private readonly rooms: RoomServiceClient;
  private readonly dispatch: AgentDispatchClient;

  constructor(private readonly cfg: LiveKitConfig) {
    // The room service API is HTTP; the configured URL is usually wss://.
    const httpUrl = cfg.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    this.rooms = new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
    this.dispatch = new AgentDispatchClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  }

  async createRoom(roomId: string, metadata: string): Promise<void> {
    await this.rooms.createRoom({ name: roomId, metadata });
  }

  async updateRoomMetadata(roomId: string, metadata: string): Promise<void> {
    await this.rooms.updateRoomMetadata(roomId, metadata);
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.rooms.deleteRoom(roomId);
  }

  async removeParticipant(roomId: string, userId: string): Promise<void> {
    await this.rooms.removeParticipant(roomId, userId);
  }

  async dispatchAgent(roomId: string): Promise<void> {
    await this.dispatch.createDispatch(roomId, this.cfg.agentWorkerName ?? "openblah-agent");
  }

  async createToken(req: TokenRequest): Promise<string> {
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, {
      identity: req.userId,
      name: req.displayName,
      ttl: req.ttlSeconds,
      metadata: JSON.stringify({ role: req.role }),
    });
    at.addGrant(grantsFor(req.role, req.roomId));
    return at.toJwt();
  }
}
