import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import type { LiveKitGateway, TokenRequest } from "./types.js";

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export class RealLiveKit implements LiveKitGateway {
  private readonly rooms: RoomServiceClient;

  constructor(private readonly cfg: LiveKitConfig) {
    // The room service API is HTTP; the configured URL is usually wss://.
    const httpUrl = cfg.url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    this.rooms = new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  }

  async createRoom(roomId: string, metadata: string): Promise<void> {
    await this.rooms.createRoom({ name: roomId, metadata });
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
