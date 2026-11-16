import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { PREVIEW_TEST_EMAIL, type TokenVerifier } from "./accounts.js";
import { apiKeyAuth, isValidApiKey } from "./auth.js";
import {
  apiKeyId,
  DATA_TERMS,
  isProvider,
  resolveRoomKeys,
  type KeyStore,
  type KeyTier,
  type ProductKeyConfig,
  type ProviderKeys,
} from "./keys.js";
import type { TrialService } from "./trial.js";
import type { AgentMode, LiveKitGateway, Room, Storage } from "./types.js";

export interface AppDeps {
  storage: Storage;
  livekit: LiveKitGateway;
  apiKeys: readonly string[];
  tokenTtlSeconds?: number;
  now?: () => Date;
  /** BYOK store. Without it the key endpoints answer 501. */
  keyStore?: KeyStore;
  /** Product keys by `apiKeyId(apiKey)`; `"*"` is the self-hosted default. */
  productKeys?: Record<string, ProductKeyConfig>;
  /** OpenBlah's hosted keys for the trial, and the trial accounting. */
  trial?: { keys: ProviderKeys; service: TrialService };
  /** Verifies Firebase ID tokens for the standalone app's own users (`/v1/me`). */
  verifier?: TokenVerifier;
  /** Secret the agent worker uses on `/internal`. Without it `/internal` is off. */
  agentSecret?: string;
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

/** A room as returned to clients: no server-only fields. */
function publicRoom(room: Room): Omit<Room, "productKeyId"> {
  const rest: Partial<Room> = { ...room };
  delete rest.productKeyId;
  return rest as Omit<Room, "productKeyId">;
}

export function createApp(deps: AppDeps): Hono {
  const { storage, livekit } = deps;
  const ttl = deps.tokenTtlSeconds ?? 600;
  const now = deps.now ?? (() => new Date());
  const app = new Hono();
  const deviceOf = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header("x-openblah-device")?.slice(0, 200) || undefined;

  const keyModesConfigured =
    !!deps.keyStore || Object.keys(deps.productKeys ?? {}).length > 0 || !!deps.trial;
  const resolve = (room: Room) =>
    resolveRoomKeys(
      {
        storage,
        keyStore: deps.keyStore ?? null,
        productKeys: deps.productKeys ?? {},
        trial: {
          keys: deps.trial?.keys ?? null,
          canStart: async (r) => {
            if (!(await storage.getUser(r.hostUserId))) return "sign_in_required";
            const dev = typeof r.metadata.deviceId === "string" ? r.metadata.deviceId : undefined;
            return (await deps.trial?.service.canStart(r.hostUserId, dev)) ? "ok" : "exhausted";
          },
        },
      },
      room,
      room.productKeyId,
    );
  const refusalStatus = {
    sensitive_free_tier: 403,
    no_key: 409,
    trial_exhausted: 402,
    sign_in_required: 401,
  } as const;

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
      productKeyId: apiKeyId(/^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? ""),
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
    // With no key modes configured the worker uses its own environment keys.
    const keys = keyModesConfigured ? await resolve(room) : { ok: true as const };
    if (!keys.ok) return c.json({ error: keys.message, code: keys.code }, refusalStatus[keys.code]);
    const { dispatchId, created } = await livekit.dispatchAgent(room.id, roomMetadataJson(room));
    return c.json({ roomId: room.id, dispatchId, created }, created ? 201 : 200);
  });

  // Which mode pays for a room, without any key material.
  v1.get("/rooms/:id/key-mode", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const r = await resolve(room);
    if (!r.ok) return c.json({ error: r.message, code: r.code }, refusalStatus[r.code]);
    return c.json({ mode: r.mode, tier: r.tier, sensitive: room.sensitive, dataTerms: DATA_TERMS });
  });

  // Key and trial endpoints. The same handlers serve a product (API key plus a
  // user ID it vouches for) and the standalone app (Firebase ID token).
  const mountKeyRoutes = (r: Hono, ownerOf: (c: Context) => string) => {
    const needStore = (): KeyStore | null => deps.keyStore ?? null;
    r.put("/keys/:provider", async (c) => {
      const store = needStore();
      if (!store) return c.json({ error: "key storage is not configured" }, 501);
      const provider = c.req.param("provider");
      if (!isProvider(provider)) return c.json({ error: "unknown provider" }, 400);
      const body = await readBody(c);
      const secret = body ? str(body.key, 500) : null;
      if (!body || !secret) return c.json({ error: "key is a required string" }, 400);
      if (body.tier !== "free" && body.tier !== "paid") {
        return c.json({ error: "tier must be free or paid" }, 400);
      }
      const info = await store.save(
        ownerOf(c),
        provider,
        secret,
        body.tier as KeyTier,
        body.noTrainingConfirmed === true,
      );
      return c.json(info, 200); // never the key itself
    });
    r.delete("/keys/:provider", async (c) => {
      const store = needStore();
      if (!store) return c.json({ error: "key storage is not configured" }, 501);
      const provider = c.req.param("provider");
      if (!isProvider(provider)) return c.json({ error: "unknown provider" }, 400);
      return (await store.delete(ownerOf(c), provider))
        ? c.body(null, 204)
        : c.json({ error: "no such key" }, 404);
    });
    r.get("/keys", async (c) => {
      const store = needStore();
      if (!store) return c.json({ error: "key storage is not configured" }, 501);
      return c.json({ keys: await store.list(ownerOf(c)) });
    });
    r.get("/trial", async (c) => {
      const user = ownerOf(c);
      if (!deps.trial) return c.json({ error: "trial is not configured" }, 501);
      if (!(await storage.getUser(user))) return c.json({ error: "sign in required" }, 401);
      return c.json(await deps.trial.service.status(user, deviceOf(c)));
    });
  };

  const byApiKey = new Hono();
  mountKeyRoutes(byApiKey, (c) => c.req.param("userId") as string);
  v1.route("/users/:userId", byApiKey);

  // Standalone app users: a verified Firebase ID token, not the product API key.
  const me = new Hono<{ Variables: { uid: string } }>();
  me.use("*", async (c, next) => {
    const m = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "");
    const user = m && deps.verifier ? await deps.verifier.verify(m[1] as string) : null;
    if (!user) return c.json({ error: "unauthorized" }, 401);
    await storage.upsertUser({
      id: user.uid,
      email: user.email,
      isTest: user.email === PREVIEW_TEST_EMAIL,
      createdAt: now().toISOString(),
    });
    c.set("uid", user.uid);
    await next();
  });
  me.get("/", async (c) => {
    const u = await storage.getUser(c.get("uid"));
    return c.json({ id: u?.id, email: u?.email });
  });
  mountKeyRoutes(me as unknown as Hono, (c) =>
    (c as unknown as { get(k: string): string }).get("uid"),
  );
  app.route("/v1/me", me);

  // Agent worker only: the one place provider keys leave the store, to the
  // server-side worker, never to a client.
  const internal = new Hono();
  internal.use("*", async (c, next) => {
    const m = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "");
    if (!deps.agentSecret || !m || !isValidApiKey(m[1] as string, [deps.agentSecret])) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });
  internal.post("/rooms/:id/provider-keys", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const r = await resolve(room);
    if (!r.ok) return c.json({ error: r.message, code: r.code }, refusalStatus[r.code]);
    return c.json({ mode: r.mode, tier: r.tier, keys: r.keys });
  });
  internal.post("/rooms/:id/usage", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const body = await readBody(c);
    const seconds = body?.seconds;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
      return c.json({ error: "seconds must be a number from 0 to 3600" }, 400);
    }
    const r = await resolve(room);
    const trialRoom = r.ok ? r.mode === "trial" : r.code === "trial_exhausted";
    if (!trialRoom || !deps.trial) return c.json({ counted: false });
    const dev = typeof room.metadata.deviceId === "string" ? room.metadata.deviceId : undefined;
    return c.json({
      counted: true,
      ...(await deps.trial.service.record(room.hostUserId, seconds, dev)),
    });
  });
  app.route("/internal", internal);

  app.route("/v1", v1);

  app.notFound((c) => c.json({ error: "not found" }, 404));
  // Never echo error details or request data: they could contain secrets.
  app.onError((err, c) => {
    console.error("request failed:", err instanceof Error ? err.name : "unknown error");
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
