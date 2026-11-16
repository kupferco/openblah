import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { apiKeyAuth } from "./auth.js";
import { RateLimiter } from "./ratelimit.js";
import type { AgentMode, LiveKitGateway, Room, Storage, WorkerWaker } from "./types.js";

export interface AppDeps {
  storage: Storage;
  livekit: LiveKitGateway;
  apiKeys: readonly string[];
  tokenTtlSeconds?: number;
  now?: () => Date;
  /** Starts the agent worker on warm-up and before dispatch. Default: does nothing. */
  worker?: WorkerWaker;
  /** Warm-up calls allowed per user per minute (default 6). */
  warmupPerMinute?: number;
  /** Clock in ms for the rate limiter; mainly for tests. */
  nowMs?: () => number;
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

export function createApp(deps: AppDeps): Hono {
  const { storage, livekit } = deps;
  const ttl = deps.tokenTtlSeconds ?? 600;
  const now = deps.now ?? (() => new Date());
  const worker: WorkerWaker = deps.worker ?? { wake: async () => false };
  const warmupLimit = new RateLimiter(deps.warmupPerMinute ?? 6, 60_000, deps.nowMs);
  // Waking is idempotent; coalesce so a burst of users causes one request to the worker.
  let lastWake = 0;
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
    const room: Room = {
      id: `rm_${randomBytes(12).toString("base64url")}`,
      hostUserId,
      hostDisplayName,
      agent: agent as AgentMode,
      sensitive: body.sensitive === true,
      metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
      createdAt: now().toISOString(),
    };
    await storage.createRoom(room);
    await livekit.createRoom(room.id, roomMetadataJson(room));
    return c.json(room, 201);
  });

  v1.get("/rooms/:id", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    return room ? c.json(room) : c.json({ error: "room not found" }, 404);
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

  // Warm-up: the client calls this when it opens, before the user taps. It only
  // wakes the agent worker (scale-to-zero); no STT, LLM or TTS call is made.
  v1.post("/warmup", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const userId = str(body.userId, MAX_ID);
    if (!userId) return c.json({ error: "userId is required" }, 400);
    const wait = warmupLimit.check(userId);
    if (wait > 0) {
      c.header("Retry-After", String(Math.ceil(wait / 1000)));
      return c.json({ error: "too many warm-up calls" }, 429);
    }
    const t = (deps.nowMs ?? Date.now)();
    if (t - lastWake < 10_000) return c.json({ status: "warm" });
    lastWake = t;
    const woke = await worker.wake();
    if (!woke) lastWake = 0;
    return c.json({ status: woke ? "warming" : "unavailable" });
  });

  // Tap-to-start: the host app calls this when the user taps to talk to the agent.
  v1.post("/rooms/:id/agent", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    if (room.agent === "off") return c.json({ error: "agent is off for this room" }, 409);
    // Make sure the worker is up (cold start); the call works as a plain room until it joins.
    await worker.wake().catch(() => false);
    const { dispatchId, created } = await livekit.dispatchAgent(room.id, roomMetadataJson(room));
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
