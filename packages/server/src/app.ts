import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { apiKeyAuth } from "./auth.js";
import type { AgentMode, LiveKitGateway, Room, Storage } from "./types.js";

export interface AppDeps {
  storage: Storage;
  livekit: LiveKitGateway;
  apiKeys: readonly string[];
  tokenTtlSeconds?: number;
  now?: () => Date;
}

const AGENT_MODES: readonly AgentMode[] = ["on", "off", "ask"];
const MAX_NAME = 100;
const MAX_ID = 200;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max ? v.trim() : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** What clients see in LiveKit room metadata (no server-only fields). */
export function roomMetadataJson(room: Room): string {
  return JSON.stringify({
    hostUserId: room.hostUserId,
    hostDisplayName: room.hostDisplayName,
    agent: room.agent,
    sensitive: room.sensitive,
    metadata: room.metadata,
  });
}

/** Room as returned by the API: MCP tokens stay server-side. */
function publicRoom(room: Room): Omit<Room, "mcp"> {
  const rest: Partial<Room> = { ...room };
  delete rest.mcp;
  return rest as Omit<Room, "mcp">;
}

/** Job metadata for the agent: the public room metadata plus private MCP config (tokens). */
export function dispatchMetadataJson(room: Room): string {
  return JSON.stringify({ ...JSON.parse(roomMetadataJson(room)), mcp: room.mcp });
}

export function createApp(deps: AppDeps): Hono {
  const { storage, livekit } = deps;
  const ttl = deps.tokenTtlSeconds ?? 600;
  const now = deps.now ?? (() => new Date());
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  const v1 = new Hono();
  v1.use("*", apiKeyAuth(deps.apiKeys));

  const readBody = async (c: {
    req: { json(): Promise<unknown> };
  }): Promise<Record<string, unknown> | null> => {
    try {
      const body = await c.req.json();
      return isRecord(body) ? body : null;
    } catch {
      return null;
    }
  };

  v1.post("/rooms", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const hostUserId = str(body.hostUserId, MAX_ID);
    const hostDisplayName = str(body.hostDisplayName, MAX_NAME);
    if (!hostUserId || !hostDisplayName) {
      return c.json({ error: "hostUserId and hostDisplayName are required strings" }, 400);
    }
    const agent = body.agent ?? "ask";
    if (!AGENT_MODES.includes(agent as AgentMode)) {
      return c.json({ error: "agent must be one of on, off, ask" }, 400);
    }
    if (body.sensitive !== undefined && typeof body.sensitive !== "boolean") {
      return c.json({ error: "sensitive must be a boolean" }, 400);
    }
    if (body.metadata !== undefined && !isRecord(body.metadata)) {
      return c.json({ error: "metadata must be an object" }, 400);
    }
    if (body.mcp !== undefined && !isRecord(body.mcp)) {
      return c.json({ error: "mcp must be an object" }, 400);
    }
    const room: Room = {
      id: `rm_${randomBytes(12).toString("base64url")}`,
      hostUserId,
      hostDisplayName,
      agent: agent as AgentMode,
      sensitive: body.sensitive === true,
      metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
      ...(body.mcp ? { mcp: { ownerId: hostUserId, ...(body.mcp as object) } } : {}),
      createdAt: now().toISOString(),
    };
    await storage.createRoom(room);
    await livekit.createRoom(room.id, roomMetadataJson(room));
    return c.json(publicRoom(room), 201);
  });

  v1.get("/rooms/:id", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    return room ? c.json(publicRoom(room)) : c.json({ error: "room not found" }, 404);
  });

  v1.post("/tokens", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const roomId = str(body.roomId, MAX_ID);
    const userId = str(body.userId, MAX_ID);
    const displayName = str(body.displayName, MAX_NAME);
    if (!roomId || !userId || !displayName) {
      return c.json({ error: "roomId, userId and displayName are required strings" }, 400);
    }
    const room = await storage.getRoom(roomId);
    if (!room) return c.json({ error: "room not found" }, 404);
    const token = await livekit.createToken({
      roomId,
      userId,
      displayName,
      isHost: userId === room.hostUserId,
      ttlSeconds: ttl,
    });
    return c.json({ token, roomId, expiresIn: ttl });
  });

  // Tap-to-start: the host app calls this when the user taps to talk to the agent.
  v1.post("/rooms/:id/agent", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    if (room.agent === "off") return c.json({ error: "agent is off for this room" }, 409);
    const { dispatchId, created } = await livekit.dispatchAgent(
      room.id,
      dispatchMetadataJson(room),
    );
    return c.json({ roomId: room.id, dispatchId, created }, created ? 201 : 200);
  });

  app.route("/v1", v1);

  app.notFound((c) => c.json({ error: "not found" }, 404));
  // Never echo error details or request data: they could contain secrets.
  app.onError((err, c) => {
    console.error("request failed:", err instanceof Error ? err.name : "unknown error");
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
