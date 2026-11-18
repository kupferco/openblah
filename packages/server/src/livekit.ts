import {
  AccessToken,
  DataPacket_Kind,
  AgentDispatchClient,
  RoomServiceClient,
} from "livekit-server-sdk";
import type { VideoGrant } from "livekit-server-sdk";
import type { LiveKitGateway, Role, TokenRequest } from "./types.js";

/** Must match the agent worker's dispatch name (packages/agent). */
export const DEFAULT_AGENT_DISPATCH_NAME = "openblah-agent";

export interface LiveKitConfig {
  url: string;
  /** Name the agent worker registers under (explicit dispatch). */
  agentName?: string;
  apiKey: string;
  apiSecret: string;
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
  private readonly dispatches: AgentDispatchClient;

  constructor(private readonly cfg: LiveKitConfig) {
    // The room service API is HTTP; the configured URL is usually wss://.
    const httpUrl = cfg.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    this.rooms = new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
    this.dispatches = new AgentDispatchClient(httpUrl, cfg.apiKey, cfg.apiSecret);
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

  async stopAgent(roomId: string): Promise<void> {
    const name = this.cfg.agentName ?? DEFAULT_AGENT_DISPATCH_NAME;
    for (const d of await this.dispatches.listDispatch(roomId)) {
      if (d.agentName === name) await this.dispatches.deleteDispatch(d.id, roomId);
    }
    // ParticipantInfo.Kind AGENT = 4: the worker's participant leaves with its job.
    for (const p of await this.rooms.listParticipants(roomId)) {
      if (p.kind === 4) await this.rooms.removeParticipant(roomId, p.identity);
    }
  }

  async sendData(roomId: string, topic: string, payload: string): Promise<void> {
    await this.rooms.sendData(roomId, new TextEncoder().encode(payload), DataPacket_Kind.RELIABLE, {
      topic,
    });
  }

  async dispatchAgent(
    roomId: string,
    metadata: string,
  ): Promise<{ dispatchId: string; created: boolean }> {
    const name = this.cfg.agentName ?? DEFAULT_AGENT_DISPATCH_NAME;
    const existing = (await this.dispatches.listDispatch(roomId)).find((d) => d.agentName === name);
    if (existing) return { dispatchId: existing.id, created: false };
    const d = await this.dispatches.createDispatch(roomId, name, { metadata });
    return { dispatchId: d.id, created: true };
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
