import { AccessToken, AgentDispatchClient, RoomServiceClient } from "livekit-server-sdk";
import type { LiveKitGateway, TokenRequest } from "./types.js";

/** Must match the agent worker's dispatch name (packages/agent). */
export const DEFAULT_AGENT_DISPATCH_NAME = "openblah-agent";

export interface LiveKitConfig {
  url: string;
  /** Name the agent worker registers under (explicit dispatch). */
  agentName?: string;
  apiKey: string;
  apiSecret: string;
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
    });
    at.addGrant({
      room: req.roomId,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      roomAdmin: req.isHost,
    });
    return at.toJwt();
  }
}
