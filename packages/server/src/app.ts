import { createHash, randomBytes } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { PREVIEW_TEST_EMAIL, type TokenVerifier } from "./accounts.js";
import { apiKeyAuth, isValidApiKey } from "./auth.js";
import { CONSENT_VERSION, DEFAULT_AGENT_NAME, renderConsentText } from "./consent.js";
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
import { callbackPage, McpOAuthError, type McpOAuthService } from "./mcp-oauth.js";
import { RateLimiter } from "./ratelimit.js";
import type { TrialService } from "./trial.js";
import type {
  AgentMode,
  Invite,
  LiveKitGateway,
  Participant,
  Role,
  Room,
  Storage,
  WorkerWaker,
} from "./types.js";

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
  /** Per-user OAuth connections to MCP servers. Without it the connection endpoints answer 501. */
  mcpOAuth?: McpOAuthService;
  /** Verifies Firebase ID tokens for the standalone app's own users (`/v1/me`). */
  verifier?: TokenVerifier;
  /** Secret the agent worker uses on `/internal`. Without it `/internal` is off. */
  agentSecret?: string;
  /** Starts the agent worker on warm-up and before dispatch. Default: does nothing. */
  worker?: WorkerWaker;
  /** Warm-up calls allowed per user per minute (default 6). */
  warmupPerMinute?: number;
  /** Clock in ms for the rate limiter; mainly for tests. */
  nowMs?: () => number;
  /** Base URL for invite links, without trailing slash. */
  inviteBaseUrl?: string;
  /** Default agent name for new rooms (Q1). */
  agentName?: string;
  /** Text for the consent line's processors list (T19 fills the real one). */
  processors?: string;
  /** LiveKit URL returned to joining guests. */
  livekitUrl?: string;
  /** Limits for the public invite endpoints. */
  joinRateLimit?: { max: number; windowMs: number };
}

export const DEFAULT_INVITE_BASE_URL = "https://openblah.web.app/j";
const DEFAULT_INVITE_TTL = 24 * 60 * 60;
const MAX_INVITE_TTL = 30 * 24 * 60 * 60;
const MAX_INVITE_USES = 100;

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** What each role may do. Enforced by the server checks below. */
export function permissionsFor(role: Role) {
  return {
    role,
    canInvokeTools: role !== "guest",
    canChangeAgentMode: role === "host",
    canSeeContacts: role !== "guest",
    isHost: role === "host",
  };
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
    agentName: room.agentName,
    sensitive: room.sensitive,
    metadata: room.metadata,
  });
}

/** Room as returned by the API: MCP tokens and server-only fields stay server-side. */
function publicRoom(room: Room): Omit<Room, "mcp" | "productKeyId"> {
  const rest: Partial<Room> = { ...room };
  delete rest.mcp;
  delete rest.productKeyId;
  return rest as Omit<Room, "mcp" | "productKeyId">;
}

/** Job metadata for the agent: the public room metadata plus private MCP config (tokens). */
export function dispatchMetadataJson(room: Room): string {
  return JSON.stringify({ ...JSON.parse(roomMetadataJson(room)), mcp: room.mcp });
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
  const baseUrl = (deps.inviteBaseUrl ?? DEFAULT_INVITE_BASE_URL).replace(/\/+$/, "");
  const defaultAgentName = deps.agentName ?? DEFAULT_AGENT_NAME;
  const rl = deps.joinRateLimit ?? { max: 10, windowMs: 60_000 };
  const ipLimiter = new RateLimiter(rl.max, rl.windowMs);
  const tokenLimiter = new RateLimiter(rl.max * 2, rl.windowMs);
  /** Job metadata for the agent, with each person's saved MCP servers merged in (no tokens). */
  const dispatchMetadata = async (room: Room): Promise<string> => {
    if (!deps.mcpOAuth) return dispatchMetadataJson(room);
    const owners = new Set([room.hostUserId]);
    for (const p of await storage.listParticipants(room.id)) {
      if (!p.removedAt && p.role !== "guest") owners.add(p.userId);
    }
    const own = (room.mcp?.servers as { url?: unknown; ownerId?: unknown }[] | undefined) ?? [];
    const servers: unknown[] = [...own];
    for (const ownerId of owners) {
      for (const conn of await deps.mcpOAuth.connected(ownerId)) {
        // Host-defined servers win over a saved one for the same URL.
        if (
          own.some((s) => s.url === conn.serverUrl && (s.ownerId ?? room.hostUserId) === ownerId)
        ) {
          continue;
        }
        servers.push({ id: conn.id, url: conn.serverUrl, ownerId, connectionId: conn.id });
      }
    }
    if (servers.length === 0) return dispatchMetadataJson(room);
    return dispatchMetadataJson({
      ...room,
      mcp: { ownerId: room.hostUserId, ...room.mcp, servers },
    });
  };
  const consentText = (room: Room) => renderConsentText(room.agentName, deps.processors);

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
    const agentName =
      body.agentName === undefined ? defaultAgentName : str(body.agentName, MAX_NAME);
    if (!agentName) return c.json({ error: "agentName must be a non-empty string" }, 400);
    const room: Room = {
      id: `rm_${randomBytes(12).toString("base64url")}`,
      hostUserId,
      hostDisplayName,
      agent: agent as AgentMode,
      agentName,
      sensitive: body.sensitive === true,
      metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
      ...(body.mcp ? { mcp: { ownerId: hostUserId, ...(body.mcp as object) } } : {}),
      createdAt: now().toISOString(),
      productKeyId: apiKeyId(/^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? ""),
    };
    await storage.createRoom(room);
    await livekit.createRoom(room.id, roomMetadataJson(room));
    await storage.saveParticipant({
      roomId: room.id,
      userId: hostUserId,
      displayName: hostDisplayName,
      role: "host",
      joinedAt: room.createdAt,
    });
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
    if (room.endedAt) return c.json({ error: "room has ended" }, 409);
    if (body.contact !== undefined && str(body.contact, MAX_NAME) === null) {
      return c.json({ error: "contact must be a non-empty string" }, 400);
    }
    const existing = await storage.getParticipant(roomId, userId);
    if (existing?.removedAt) return c.json({ error: "participant was removed" }, 403);
    // A guest id cannot be upgraded to a member through this endpoint.
    if (existing?.role === "guest") return c.json({ error: "user id is a guest" }, 403);
    const isHost = userId === room.hostUserId;
    const role: Role = isHost ? "host" : "member";
    await storage.saveParticipant({
      roomId,
      userId,
      displayName,
      role,
      ...(body.contact !== undefined ? { contact: str(body.contact, MAX_NAME)! } : {}),
      ...(existing?.contact && body.contact === undefined ? { contact: existing.contact } : {}),
      joinedAt: existing?.joinedAt ?? now().toISOString(),
    });
    const token = await livekit.createToken({
      roomId,
      userId,
      displayName,
      isHost,
      role,
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

  // ---- Host-control helpers ----

  type Ctx = Context;
  /** The acting user comes from the trusted host-app backend (API key). */
  const actorOf = (c: Ctx, body: Record<string, unknown> | null): string | null =>
    str(body?.actorUserId ?? c.req.query("actorUserId"), MAX_ID);

  const loadRoom = async (c: Ctx): Promise<Room | Response> => {
    const room = await storage.getRoom(c.req.param("id") ?? "");
    return room ? room : c.json({ error: "room not found" }, 404);
  };

  /** Resolve the actor's role in the room, or an error response. */
  const roleOf = async (c: Ctx, room: Room, actor: string | null): Promise<Role | Response> => {
    if (!actor) return c.json({ error: "actorUserId is required" }, 400);
    if (actor === room.hostUserId) return "host";
    const p = await storage.getParticipant(room.id, actor);
    if (!p || p.removedAt) return c.json({ error: "not a participant of this room" }, 403);
    return p.role;
  };

  /** Host only, on a live room. Returns the room or an error response. */
  const hostRoom = async (
    c: Ctx,
    body: Record<string, unknown> | null,
    opts: { allowEnded?: boolean } = {},
  ): Promise<Room | Response> => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, actorOf(c, body));
    if (role instanceof Response) return role;
    if (role !== "host") return c.json({ error: "only the host can do this" }, 403);
    if (room.endedAt && !opts.allowEnded) return c.json({ error: "room has ended" }, 409);
    return room;
  };

  const activeParticipants = async (roomId: string): Promise<Participant[]> =>
    (await storage.listParticipants(roomId)).filter((p) => !p.removedAt);

  const publicParticipant = (p: Participant, canSeeContacts: boolean) => ({
    userId: p.userId,
    displayName: p.displayName,
    role: p.role,
    joinedAt: p.joinedAt,
    ...(canSeeContacts && p.contact ? { contact: p.contact } : {}),
  });

  // ---- Invites ----

  v1.post("/rooms/:id/invites", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    const ttlSec = body.expiresInSeconds ?? DEFAULT_INVITE_TTL;
    if (
      !Number.isInteger(ttlSec) ||
      (ttlSec as number) < 60 ||
      (ttlSec as number) > MAX_INVITE_TTL
    ) {
      return c.json(
        { error: `expiresInSeconds must be an integer from 60 to ${MAX_INVITE_TTL}` },
        400,
      );
    }
    const maxUses = body.maxUses ?? 1;
    if (
      !Number.isInteger(maxUses) ||
      (maxUses as number) < 1 ||
      (maxUses as number) > MAX_INVITE_USES
    ) {
      return c.json({ error: `maxUses must be an integer from 1 to ${MAX_INVITE_USES}` }, 400);
    }
    const token = randomBytes(24).toString("base64url");
    const created = now();
    const invite: Invite = {
      id: `inv_${randomBytes(9).toString("base64url")}`,
      roomId: room.id,
      tokenHash: sha256(token),
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + (ttlSec as number) * 1000).toISOString(),
      maxUses: maxUses as number,
      uses: 0,
      revoked: false,
    };
    await storage.createInvite(invite);
    // The raw token is only ever returned here.
    return c.json(
      {
        id: invite.id,
        roomId: room.id,
        token,
        url: `${baseUrl}/${token}`,
        expiresAt: invite.expiresAt,
        maxUses: invite.maxUses,
      },
      201,
    );
  });

  v1.delete("/rooms/:id/invites/:inviteId", async (c) => {
    const room = await hostRoom(c, null);
    if (room instanceof Response) return room;
    const invite = await storage.getInvite(c.req.param("inviteId"));
    if (!invite || invite.roomId !== room.id) return c.json({ error: "invite not found" }, 404);
    await storage.revokeInvite(invite.id);
    return c.json({ id: invite.id, revoked: true });
  });

  // ---- Participants, host controls ----

  v1.get("/rooms/:id/participants", async (c) => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, str(c.req.query("viewerUserId"), MAX_ID));
    if (role instanceof Response) return role;
    const list = await activeParticipants(room.id);
    return c.json({ participants: list.map((p) => publicParticipant(p, role !== "guest")) });
  });

  v1.get("/rooms/:id/permissions", async (c) => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, str(c.req.query("userId"), MAX_ID));
    if (role instanceof Response) return role;
    return c.json(permissionsFor(role));
  });

  v1.delete("/rooms/:id/participants/:userId", async (c) => {
    const room = await hostRoom(c, null);
    if (room instanceof Response) return room;
    const target = c.req.param("userId");
    if (target === room.hostUserId) return c.json({ error: "the host cannot be removed" }, 400);
    const p = await storage.getParticipant(room.id, target);
    if (!p || p.removedAt) return c.json({ error: "participant not found" }, 404);
    await storage.saveParticipant({ ...p, removedAt: now().toISOString() });
    await livekit.removeParticipant(room.id, target);
    return c.json({ userId: target, removed: true });
  });

  v1.post("/rooms/:id/end", async (c) => {
    const body = (await readBody(c)) ?? {};
    const room = await hostRoom(c, body, { allowEnded: true });
    if (room instanceof Response) return room;
    if (!room.endedAt) {
      await storage.updateRoom({ ...room, endedAt: now().toISOString() });
      await livekit.deleteRoom(room.id);
    }
    return c.json({ id: room.id, ended: true });
  });

  v1.put("/rooms/:id/agent", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    if (!AGENT_MODES.includes(body.agent as AgentMode)) {
      return c.json({ error: "agent must be one of on, off, ask" }, 400);
    }
    const updated: Room = { ...room, agent: body.agent as AgentMode };
    await storage.updateRoom(updated);
    await livekit.updateRoomMetadata(room.id, roomMetadataJson(updated));
    return c.json(updated);
  });

  // Stub until T13 (write-action confirmation) adds real pending actions.
  v1.post("/rooms/:id/approvals/:approvalId", async (c) => {
    const body = (await readBody(c)) ?? {};
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    return c.json({ error: "tool approvals are not implemented yet" }, 501);
  });

  // ---- Consent ----

  const consentState = async (room: Room) => {
    const participants = await activeParticipants(room.id);
    const consents = await storage.listConsents(room.id);
    const ok = new Set(
      consents.filter((x) => x.textVersion === CONSENT_VERSION).map((x) => x.userId),
    );
    const missing = participants.filter((p) => !ok.has(p.userId));
    return { participants, missing };
  };

  v1.get("/rooms/:id/consent", async (c) => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, str(c.req.query("userId"), MAX_ID));
    if (role instanceof Response) return role;
    const { missing } = await consentState(room);
    return c.json({
      version: CONSENT_VERSION,
      text: consentText(room),
      agentName: room.agentName,
      missing: missing.map((p) => ({ userId: p.userId, displayName: p.displayName })),
    });
  });

  v1.post("/rooms/:id/consent", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    if (room.endedAt) return c.json({ error: "room has ended" }, 409);
    const userId = str(body.userId, MAX_ID);
    if (!userId) return c.json({ error: "userId is required" }, 400);
    const role = await roleOf(c, room, userId);
    if (role instanceof Response) return role;
    if (body.accepted !== true) return c.json({ error: "accepted must be true" }, 400);
    if (body.textVersion !== CONSENT_VERSION) {
      return c.json(
        { error: "textVersion is not the current consent version", current: CONSENT_VERSION },
        400,
      );
    }
    const consentedAt = now().toISOString();
    await storage.saveConsent({
      roomId: room.id,
      userId,
      textVersion: CONSENT_VERSION,
      consentedAt,
    });
    return c.json({ roomId: room.id, userId, textVersion: CONSENT_VERSION, consentedAt });
  });

  /**
   * Send the agent in. Refused while the room is AI off or any current
   * participant has not consented; the host can set the room to AI off instead.
   */
  v1.post("/rooms/:id/agent/dispatch", async (c) => {
    const body = (await readBody(c)) ?? {};
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    if (room.agent === "off") return c.json({ error: "the agent is off in this room" }, 409);
    const { missing } = await consentState(room);
    if (missing.length > 0) {
      return c.json(
        {
          error: "not every participant has consented",
          missing: missing.map((p) => ({ userId: p.userId, displayName: p.displayName })),
        },
        409,
      );
    }
    await livekit.dispatchAgent(room.id, roomMetadataJson(room));
    return c.json({ dispatched: true });
  });

  // ---- Public guest endpoints (no API key; rate limited) ----

  const clientIp = (c: Ctx): string => {
    // On Cloud Run the last entry is the one the Google front end appended.
    const xff = c.req.header("x-forwarded-for") ?? "";
    const parts = xff
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    return parts[parts.length - 1] ?? "unknown";
  };

  const limited = (c: Ctx, token: string): Response | null => {
    const t = now().getTime();
    const ipOk = ipLimiter.allow(clientIp(c), t);
    const tokOk = tokenLimiter.allow(sha256(token), t);
    if (ipOk && tokOk) return null;
    c.header("Retry-After", String(Math.ceil(rl.windowMs / 1000)));
    return c.json({ error: "too many requests" }, 429);
  };

  /** One generic failure for unknown, expired, revoked and used-up invites. */
  const invalidInvite = (c: Ctx) => c.json({ error: "invite is not valid" }, 404);

  const usableInvite = async (token: string): Promise<{ invite: Invite; room: Room } | null> => {
    const invite = await storage.getInviteByTokenHash(sha256(token));
    if (!invite || invite.revoked || invite.uses >= invite.maxUses) return null;
    if (Date.parse(invite.expiresAt) <= now().getTime()) return null;
    const room = await storage.getRoom(invite.roomId);
    if (!room || room.endedAt) return null;
    return { invite, room };
  };

  app.use("/v1/invites/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

  // What the guest page shows before asking for a name and consent.
  app.get("/v1/invites/:token", async (c) => {
    const token = c.req.param("token");
    const blocked = limited(c, token);
    if (blocked) return blocked;
    const found = await usableInvite(token);
    if (!found) return invalidInvite(c);
    const { room } = found;
    return c.json({
      hostDisplayName: room.hostDisplayName,
      agent: room.agent,
      agentName: room.agentName,
      consent: { version: CONSENT_VERSION, text: consentText(room) },
    });
  });

  app.post("/v1/invites/:token/join", async (c) => {
    const token = c.req.param("token");
    const blocked = limited(c, token);
    if (blocked) return blocked;
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const displayName = str(body.displayName, MAX_NAME);
    if (!displayName) return c.json({ error: "displayName is required" }, 400);
    const found = await usableInvite(token);
    if (!found) return invalidInvite(c);
    const { invite, room } = found;
    const consent = isRecord(body.consent) ? body.consent : null;
    const consented = consent?.accepted === true;
    if (consent && consent.textVersion !== CONSENT_VERSION) {
      return c.json({ error: "consent textVersion is not current", current: CONSENT_VERSION }, 400);
    }
    // With the agent off nothing is listening, so consent can wait until it is brought in.
    if (room.agent !== "off" && !consented) {
      return c.json({ error: "consent is required to join this room" }, 400);
    }
    // Check everything before using up an invite slot.
    const used = await storage.consumeInvite(invite.id, now());
    if (!used) return invalidInvite(c);
    const userId = `guest_${randomBytes(12).toString("base64url")}`;
    const joinedAt = now().toISOString();
    await storage.saveParticipant({
      roomId: room.id,
      userId,
      displayName,
      role: "guest",
      joinedAt,
    });
    if (consented) {
      await storage.saveConsent({
        roomId: room.id,
        userId,
        textVersion: CONSENT_VERSION,
        consentedAt: joinedAt,
      });
    }
    const jwt = await livekit.createToken({
      roomId: room.id,
      userId,
      displayName,
      isHost: false,
      role: "guest",
      ttlSeconds: ttl,
    });
    return c.json({
      token: jwt,
      roomId: room.id,
      userId,
      role: "guest",
      expiresIn: ttl,
      ...(deps.livekitUrl ? { livekitUrl: deps.livekitUrl } : {}),
    });
  });

  // Tap-to-start: the host app calls this when the user taps to talk to the agent.
  v1.post("/rooms/:id/agent", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    if (room.agent === "off") return c.json({ error: "agent is off for this room" }, 409);
    // With no key modes configured the worker uses its own environment keys.
    const keys = keyModesConfigured ? await resolve(room) : { ok: true as const };
    if (!keys.ok) return c.json({ error: keys.message, code: keys.code }, refusalStatus[keys.code]);
    // Make sure the worker is up (cold start); the call works as a plain room until it joins.
    await worker.wake().catch(() => false);
    const { dispatchId, created } = await livekit.dispatchAgent(
      room.id,
      await dispatchMetadata(room),
    );
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

  // MCP OAuth connections. Same handlers for a product user and a standalone-app user.
  const mountMcpRoutes = (r: Hono, ownerOf: (c: Context) => string) => {
    const svc = (): McpOAuthService | null => deps.mcpOAuth ?? null;
    const guard =
      (fn: (s: McpOAuthService, c: Context) => Promise<Response>) =>
      async (c: Context): Promise<Response> => {
        const s = svc();
        if (!s) return c.json({ error: "MCP connections are not configured" }, 501);
        try {
          return await fn(s, c);
        } catch (e) {
          if (e instanceof McpOAuthError) return c.json({ error: e.message }, e.status);
          throw e;
        }
      };
    r.post(
      "/mcp/connections",
      guard(async (s, c) => {
        const body = await readBody(c);
        const url = body ? str(body.url, 2000) : null;
        if (!body || !url) return c.json({ error: "url is a required string" }, 400);
        const opt = (v: unknown, max: number) => (v === undefined ? undefined : str(v, max));
        const name = opt(body.name, MAX_NAME);
        const scope = opt(body.scope, 500);
        const returnUrl = opt(body.returnUrl, 2000);
        if (name === null || scope === null || returnUrl === null) {
          return c.json({ error: "name, scope and returnUrl must be non-empty strings" }, 400);
        }
        const started = await s.start(ownerOf(c), { url, name, scope, returnUrl });
        return c.json(started, 201);
      }),
    );
    r.get(
      "/mcp/connections",
      guard(async (s, c) => c.json({ connections: await s.list(ownerOf(c)) })),
    );
    r.get(
      "/mcp/connections/:id",
      guard(async (s, c) => c.json(await s.get(ownerOf(c), c.req.param("id") ?? ""))),
    );
    r.post(
      "/mcp/connections/:id/test",
      guard(async (s, c) => c.json(await s.test(ownerOf(c), c.req.param("id") ?? ""))),
    );
    r.delete(
      "/mcp/connections/:id",
      guard(async (s, c) => {
        await s.disconnect(ownerOf(c), c.req.param("id") ?? "");
        return c.body(null, 204);
      }),
    );
  };

  const byApiKey = new Hono();
  mountKeyRoutes(byApiKey, (c) => c.req.param("userId") as string);
  mountMcpRoutes(byApiKey, (c) => c.req.param("userId") as string);
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
  mountMcpRoutes(me as unknown as Hono, (c) =>
    (c as unknown as { get(k: string): string }).get("uid"),
  );
  app.route("/v1/me", me);

  // The consent redirect lands here, in the user's browser: no API key. The
  // one-time `state` (checked against its stored hash) says which sign-in this is.
  app.get("/v1/mcp/callback", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
    if (!deps.mcpOAuth)
      return c.html(callbackPage(false, "MCP connections are not configured."), 501);
    const r = await deps.mcpOAuth.complete({
      state: c.req.query("state"),
      code: c.req.query("code"),
      error: c.req.query("error"),
    });
    if (r.returnUrl) return c.redirect(r.returnUrl, 302);
    return c.html(callbackPage(r.ok, r.message), r.ok ? 200 : 400);
  });

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
  // The agent asks for a connection's current token when it connects and on each
  // request. Only for people who are in the room, and only the owner's own connection.
  internal.post("/rooms/:id/mcp-token", async (c) => {
    if (!deps.mcpOAuth) return c.json({ error: "MCP connections are not configured" }, 501);
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const body = await readBody(c);
    const ownerId = body ? str(body.ownerId, MAX_ID) : null;
    const connectionId = body ? str(body.connectionId, MAX_ID) : null;
    if (!ownerId || !connectionId) {
      return c.json({ error: "ownerId and connectionId are required strings" }, 400);
    }
    const p = ownerId === room.hostUserId ? null : await storage.getParticipant(room.id, ownerId);
    if (ownerId !== room.hostUserId && (!p || p.removedAt || p.role === "guest")) {
      return c.json({ error: "not a member of this room" }, 403);
    }
    try {
      return c.json(
        await deps.mcpOAuth.accessToken(ownerId, connectionId, {
          forceRefresh: body?.refresh === true,
        }),
      );
    } catch (e) {
      if (e instanceof McpOAuthError) return c.json({ error: e.message }, e.status);
      throw e;
    }
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
