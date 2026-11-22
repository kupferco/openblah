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
  PROVIDERS,
  resolveRoomKeys,
  type KeyResolverDeps,
  type Resolution,
  type KeyStore,
  type KeyTier,
  type ProductKeyConfig,
  type ProviderKeys,
} from "./keys.js";
import { vendorKeyChecker, type KeyChecker } from "./keycheck.js";
import { callbackPage, McpOAuthError, type McpOAuthService } from "./mcp-oauth.js";
import {
  canReadHistory,
  cleanupExpiredHistory,
  DEFAULT_RETENTION,
  deleteCallHistory,
  isRetention,
  toListItem,
  type ActionLogEntry,
  type CallHistory,
  type TranscriptLine,
} from "./history.js";
import { OWNER_PAGE_CSP, OWNER_PAGE_HTML } from "./owner-page.js";
import { RateLimiter } from "./ratelimit.js";
import { DEFAULT_PRODUCT_USER_MINUTES, ProductStatsService } from "./product-stats.js";
import {
  applyPatch,
  applyProductPatch,
  ConfirmationSigner,
  isProductPatch,
  isRoomPatch,
  describePatch,
  GEMINI_KEY_URL,
  llmLabel,
  llmUsable,
  LLM_NAMES,
  parsePatch,
  resolveLanguage,
  resolveModel,
  type SettingLevels,
  type SettingsLevel,
  type WhoPays,
  type SettingsPatch,
} from "./settings.js";
import { settingsMcpApp, type SettingsToolOps, type ToolOutcome } from "./settings-mcp.js";
import { DEFAULT_PRODUCT_TRIAL_SECONDS, ProductTrialService, type TrialService } from "./trial.js";
import { signWatchTicket, WATCH_PROTOCOL_VERSION } from "./watch.js";
import { UsageService, type UsageReport } from "./usage.js";
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
  /** Usage log, caps and the monthly cost counter. Default: built-in limits and prices. */
  usage?: UsageService;
  /** Per-user OAuth connections to MCP servers. Without it the connection endpoints answer 501. */
  mcpOAuth?: McpOAuthService;
  /** Verifies Firebase ID tokens for the standalone app's own users (`/v1/me`). */
  verifier?: TokenVerifier;
  /** Secret for the scheduled history cleanup (`POST /internal/history/cleanup`). Without it the endpoint is off. */
  cleanupSecret?: string;
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
  /** `cloud` (LiveKit Cloud, default) or `self_hosted`. Reported by `/health`; the URL decides where rooms go. */
  livekitMode?: "cloud" | "self_hosted";
  /** The server-default level of the model setting (lowest precedence). */
  serverSettings?: SettingsLevel;
  /** Who pays for a product that has not chosen (new products: `user_key`). Unset keeps the older key order. */
  defaultWhoPays?: WhoPays;
  /** Replaces the built-in per-product allowance check (tests). Default: the per-user, per-product counter. */
  productTrial?: KeyResolverDeps["productTrial"];
  /** Allowance in seconds for a product that has not set `trialSeconds`. Default 300. */
  defaultProductTrialSeconds?: number;
  /** Checks a key with its vendor. Default: a free "list models" call; mocked in tests. */
  keyChecker?: KeyChecker;
  /** Secret that signs watch tickets. Setting it turns the Apple Watch bridge on (spike T27); without it the watch endpoint answers 404. */
  watchSecret?: string;
  /** `wss://` URL of the watch socket returned with the ticket. */
  watchSocketUrl?: string;
  /** Limits for the public invite endpoints. */
  joinRateLimit?: { max: number; windowMs: number };
}

export const DEFAULT_INVITE_BASE_URL = "https://openblah.web.app/j";
/** Routes a signed-in standalone-app user may call with their own ID token (see `v1.use`). */
const USER_ROUTE =
  /^\/(history(\/[^/]+)?|rooms\/[^/]+\/(invites(\/[^/]+)?|history-settings|consent|participants|permissions|mcp-servers|agent|agent\/(bring-in|send-out|requests\/[^/]+\/(approve|decline))))$/;
const DEFAULT_INVITE_TTL = 24 * 60 * 60;
const MAX_INVITE_TTL = 30 * 24 * 60 * 60;
const MAX_INVITE_USES = 100;

export const ONBOARDING_INTRO =
  "Pick the model that powers your agent. Gemini is the quickest way to start: Google gives a free key, and you can also try it for a few minutes first.";
export const ONBOARDING_COPY = {
  gemini:
    "Free to start. Get a free key from Google, or try the free trial. The free tier may use your audio and text to improve Google models, so do not use it for private data.",
  openai: "Bring your own OpenAI key. Usage is billed to your OpenAI account.",
  claude: "Bring your own Anthropic key. Usage is billed to your Anthropic account.",
} as const;

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
    anyoneCanAddAgent: room.anyoneCanAddAgent === true,
    agentAwaitingConsent: room.agentAwaitingConsent === true,
    agentRequests: room.agentRequests ?? [],
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
export function dispatchMetadataJson(room: Room, extra: object = {}): string {
  return JSON.stringify({ ...JSON.parse(roomMetadataJson(room)), mcp: room.mcp, ...extra });
}

/** Data topic on which the server forwards approval decisions to the agent. */
export const APPROVAL_DECISION_TOPIC = "openblah.approval.decision";

/** The saved MCP connections the host switched on for this room; `null` means all of them. */
function enabledConnectionIds(room: Room): string[] | null {
  const ids = room.mcp?.enabledConnectionIds;
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : null;
}

/** Who owns tool credentials in a room: the host and each tool's `ownerId`. */
function toolOwners(room: Room): Set<string> {
  const owner = room.mcp?.ownerId;
  const out = new Set<string>([typeof owner === "string" ? owner : room.hostUserId]);
  for (const key of ["servers", "webhookTools"]) {
    const list = room.mcp?.[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const o = (item as { ownerId?: unknown } | null)?.ownerId;
      if (typeof o === "string") out.add(o);
    }
  }
  return out;
}

export function createApp(deps: AppDeps): Hono {
  const { storage, livekit } = deps;
  const ttl = deps.tokenTtlSeconds ?? 600;
  const now = deps.now ?? (() => new Date());
  const usage = deps.usage ?? new UsageService(storage, { now });
  const worker: WorkerWaker = deps.worker ?? { wake: async () => false };
  const warmupLimit = new RateLimiter(deps.warmupPerMinute ?? 6, 60_000, deps.nowMs);
  // Waking is idempotent; coalesce so a burst of users causes one request to the worker.
  let lastWake = 0;
  const app = new Hono();
  const deviceOf = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header("x-openblah-device")?.slice(0, 200) || undefined;

  const keyModesConfigured =
    !!deps.keyStore || Object.keys(deps.productKeys ?? {}).length > 0 || !!deps.trial;
  const productTrialCounter = new ProductTrialService(storage);
  const productTrialSeconds = async (productKeyId: string) =>
    (await storage.getSettings(`product:${productKeyId}`))?.trialSeconds ??
    deps.defaultProductTrialSeconds ??
    DEFAULT_PRODUCT_TRIAL_SECONDS;
  const whoPaysOf = async (room: Room): Promise<WhoPays | null> =>
    room.productKeyId
      ? ((await storage.getSettings(`product:${room.productKeyId}`))?.whoPays ??
        deps.defaultWhoPays ??
        null)
      : null;
  const stats = new ProductStatsService(storage, deps.keyStore ?? null, now);
  const resolve = async (room: Room) => {
    const r = await resolveWithMode(room);
    // Count who was asked for a key, per product (a person once a day, never their name).
    if (!r.ok && r.code === "key_required" && room.productKeyId) {
      await stats.keyRequired(room.productKeyId, room.hostUserId).catch(() => undefined);
    }
    return r;
  };
  const resolveWithMode = async (room: Room) =>
    resolveRoomKeys(
      {
        storage,
        productTrial: deps.productTrial ?? {
          hasAllowance: async (r, pid) =>
            (await productTrialCounter.status(pid, r.hostUserId, await productTrialSeconds(pid)))
              .available,
        },
        keyStore: deps.keyStore ?? null,
        productKeys: deps.productKeys ?? {},
        trial: {
          keys: deps.trial?.keys ?? null,
          canStart: async (r) => {
            if (!(await storage.getUser(r.hostUserId))) return "sign_in_required";
            // The hosted keys stop for everyone at the monthly cost cap.
            if (await usage.hostedCapReached()) return "exhausted";
            const dev = typeof r.metadata.deviceId === "string" ? r.metadata.deviceId : undefined;
            return (await deps.trial?.service.canStart(r.hostUserId, dev)) ? "ok" : "exhausted";
          },
        },
      },
      room,
      room.productKeyId,
      await whoPaysOf(room),
    );
  const refusalBody = (r: Extract<Resolution, { ok: false }>) => ({
    error: r.message,
    code: r.code,
    ...(r.code === "key_required" ? { reason: r.reason } : {}),
  });
  const refusalStatus = {
    key_required: 402,
    sensitive_free_tier: 403,
    no_key: 409,
    trial_exhausted: 402,
    sign_in_required: 401,
  } as const;
  const livekitCapBody = (scope: "product" | "global") => ({
    error:
      scope === "global"
        ? "Voice calls are paused for everyone until next month. Try again then."
        : "This app has used its voice call minutes for this month. Try again next month.",
    code: "livekit_cap" as const,
    scope,
  });
  const baseUrl = (deps.inviteBaseUrl ?? DEFAULT_INVITE_BASE_URL).replace(/\/+$/, "");
  const defaultAgentName = deps.agentName ?? DEFAULT_AGENT_NAME;
  const rl = deps.joinRateLimit ?? { max: 10, windowMs: 60_000 };
  const ipLimiter = new RateLimiter(rl.max, rl.windowMs);
  const tokenLimiter = new RateLimiter(rl.max * 2, rl.windowMs);
  /** Job metadata for the agent, with each person's saved MCP servers merged in (no tokens). */
  const dispatchMetadata = async (room: Room, extra: object = {}): Promise<string> => {
    if (!deps.mcpOAuth) return dispatchMetadataJson(room, extra);
    const owners = new Set([room.hostUserId]);
    for (const p of await storage.listParticipants(room.id)) {
      if (!p.removedAt && p.role !== "guest") owners.add(p.userId);
    }
    const own = (room.mcp?.servers as { url?: unknown; ownerId?: unknown }[] | undefined) ?? [];
    const servers: unknown[] = [...own];
    const enabled = enabledConnectionIds(room);
    for (const ownerId of owners) {
      for (const conn of await deps.mcpOAuth.connected(ownerId)) {
        if (enabled && !enabled.includes(conn.id)) continue;
        // Host-defined servers win over a saved one for the same URL.
        if (
          own.some((s) => s.url === conn.serverUrl && (s.ownerId ?? room.hostUserId) === ownerId)
        ) {
          continue;
        }
        servers.push({ id: conn.id, url: conn.serverUrl, ownerId, connectionId: conn.id });
      }
    }
    if (servers.length === 0) return dispatchMetadataJson(room, extra);
    return dispatchMetadataJson(
      { ...room, mcp: { ownerId: room.hostUserId, ...room.mcp, servers } },
      extra,
    );
  };
  const consentText = (room: Room) => renderConsentText(room.agentName, deps.processors);

  // Which LiveKit this server uses and whether it answers. A down LiveKit does not fail the
  // probe (the server itself is fine); read `livekit.reachable`. Never exposes keys or the path.
  // The owner settings screen: a static page; the product key is typed in and never stored.
  app.get("/owner", (c) =>
    c.body(OWNER_PAGE_HTML, 200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": OWNER_PAGE_CSP,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    }),
  );

  app.get("/health", async (c) => {
    let reachable: boolean | null = null;
    if (livekit.ping) {
      reachable = await Promise.race([
        livekit.ping().then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), 3000).unref?.()),
      ]);
    }
    let host: string | null = null;
    try {
      host = deps.livekitUrl ? new URL(deps.livekitUrl).host : null;
    } catch {
      /* not a URL: report nothing */
    }
    return c.json({
      ok: true,
      livekit: { mode: deps.livekitMode ?? "cloud", host, reachable },
    });
  });

  // ---- Settings: model at three levels, language, agent name (T17) ----

  const keyUsability = {
    keyModesConfigured,
    keyStore: deps.keyStore ?? null,
    productKeys: deps.productKeys ?? {},
    trialConfigured: !!deps.trial,
  };
  const checkKey = deps.keyChecker ?? vendorKeyChecker();
  const signer = new ConfirmationSigner(deps.agentSecret ?? randomBytes(32).toString("hex"));
  const keyIdOf = (c: Context) =>
    apiKeyId(/^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? "");

  const levelsFor = async (o: {
    room?: Room;
    userId?: string;
    productKeyId?: string;
  }): Promise<SettingLevels> => ({
    room: o.room?.settings ?? null,
    user: o.userId ? await storage.getSettings(`user:${o.userId}`) : null,
    product: o.productKeyId ? await storage.getSettings(`product:${o.productKeyId}`) : null,
    server: deps.serverSettings ?? null,
  });

  /** The mode that applies to a product: its setting, else the server default. Null = not chosen. */
  const effectiveWhoPays = (level: SettingsLevel | null): WhoPays | null =>
    level?.whoPays ?? deps.defaultWhoPays ?? null;

  /**
   * Per-user monthly minutes for a product's rooms: its own setting (0 = off); else 60 while the
   * product pays (Q3); else the server's cap. Undefined = the server's cap.
   */
  const productUserCap = async (room: Room): Promise<number | undefined> => {
    if (!room.productKeyId) return undefined;
    const level = await storage.getSettings(`product:${room.productKeyId}`);
    if (level?.userMonthlyMinutes !== undefined) return level.userMonthlyMinutes;
    return effectiveWhoPays(level) === "product" ? DEFAULT_PRODUCT_USER_MINUTES : undefined;
  };

  /** What the product owner sees: the mode, the cap and counts only (never names or keys). */
  const ownerView = async (productKeyId: string) => {
    const level = await storage.getSettings(`product:${productKeyId}`);
    const whoPays = effectiveWhoPays(level);
    const cap =
      level?.userMonthlyMinutes ??
      (whoPays === "product" ? DEFAULT_PRODUCT_USER_MINUTES : usage.limits.userMonthlyMinutes);
    return {
      whoPays,
      userMonthlyMinutes: cap > 0 ? cap : null,
      ...(await stats.summary(productKeyId)),
    };
  };

  /** The effective settings plus each level, for settings screens and the agent. */
  const settingsView = async (o: {
    room?: Room;
    userId?: string;
    productKeyId?: string;
    /** The caller holds this product's API key: add the owner block. */
    owner?: boolean;
  }) => {
    const levels = await levelsFor(o);
    const { choice, source } = resolveModel(levels);
    const usable = await llmUsable(keyUsability, choice.provider, {
      ownerId: o.userId,
      productKeyId: o.productKeyId,
    });
    return {
      llm: choice,
      source,
      usable: usable.ok,
      ...(usable.ok ? { keyMode: usable.mode } : { problem: usable.message }),
      language: resolveLanguage(levels) ?? "auto",
      ...(o.room ? { agentName: o.room.agentName } : {}),
      ...(o.owner && o.productKeyId ? { product: await ownerView(o.productKeyId) } : {}),
      levels: {
        ...(o.room ? { room: levels.room ?? null } : {}),
        user: levels.user ?? null,
        product: levels.product ?? null,
        server: levels.server ?? null,
      },
    };
  };

  /** What the agent worker gets in its job metadata: the settings already resolved. */
  const settingsForAgent = async (room: Room) => {
    const levels = await levelsFor({
      room,
      userId: room.hostUserId,
      productKeyId: room.productKeyId,
    });
    const hasModel = !!(
      levels.room?.llm ??
      levels.user?.llm ??
      levels.product?.llm ??
      levels.server?.llm
    );
    const language = resolveLanguage(levels);
    return {
      ...(hasModel ? { providers: { llm: resolveModel(levels).choice } } : {}),
      ...(language ? { language } : {}),
    };
  };

  type Applied =
    { ok: true; room: Room } | { ok: false; status: 400 | 409; error: string; code?: string };

  /** Check the chosen provider has a usable key, then save the change on the room. */
  const applyRoomPatch = async (room: Room, patch: SettingsPatch): Promise<Applied> => {
    if (patch.llm) {
      const u = await llmUsable(keyUsability, patch.llm.provider, {
        ownerId: room.hostUserId,
        productKeyId: room.productKeyId,
      });
      if (!u.ok) return { ok: false, status: 409, error: u.message, code: u.code };
    }
    if (isProductPatch(patch) && room.productKeyId) {
      const id = `product:${room.productKeyId}`;
      await storage.putSettings(id, applyProductPatch(await storage.getSettings(id), patch));
    }
    if (!isRoomPatch(patch)) return { ok: true, room };
    const updated: Room = {
      ...room,
      ...(patch.agentName ? { agentName: patch.agentName } : {}),
      settings: applyPatch(room.settings, patch),
    };
    await storage.updateRoom(updated);
    if (patch.agentName) await livekit.updateRoomMetadata(room.id, roomMetadataJson(updated));
    return { ok: true, room: updated };
  };

  const fail = (c: Context, r: { status: 400 | 409; error: string; code?: string }) =>
    c.json({ error: r.error, ...(r.code ? { code: r.code } : {}) }, r.status);

  const v1 = new Hono();
  // Product backends use the API key. Standalone-app users may reach the routes they need
  // (invites, history, agent control, consent, per-room tools) with their Firebase ID token, but
  // only as themselves: every actor/user id in the request must be their own verified uid.
  const apiKeyGate = apiKeyAuth(deps.apiKeys);
  v1.use("*", async (c, next) => {
    const m = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "");
    if (m && isValidApiKey(m[1] as string, deps.apiKeys)) return apiKeyGate(c, next);
    const path = c.req.path.replace(/^\/v1/, "");
    const user =
      m && deps.verifier && USER_ROUTE.test(path)
        ? await deps.verifier.verify(m[1] as string)
        : null;
    if (!user) return apiKeyGate(c, next);
    const ids: unknown[] = ["actorUserId", "userId", "viewerUserId"].map((k) => c.req.query(k));
    if (c.req.method !== "GET" && c.req.method !== "DELETE") {
      const b: unknown = await c.req.raw
        .clone()
        .json()
        .catch(() => null);
      if (isRecord(b)) ids.push(b.actorUserId, b.userId, b.hostUserId);
    }
    const given = ids.filter((v) => v !== undefined);
    if (given.length === 0 || given.some((v) => v !== user.uid)) {
      return c.json({ error: "you can only act as yourself" }, 403);
    }
    await next();
  });

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
    if (body.anyoneCanAddAgent !== undefined && typeof body.anyoneCanAddAgent !== "boolean") {
      return c.json({ error: "anyoneCanAddAgent must be a boolean" }, 400);
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
    const limitOf = (v: unknown): number | undefined | null => {
      if (v === undefined) return undefined;
      return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 86_400 ? v : null;
    };
    const maxDurationSeconds = limitOf(body.maxDurationSeconds);
    const idleTimeoutSeconds = limitOf(body.idleTimeoutSeconds);
    if (maxDurationSeconds === null || idleTimeoutSeconds === null) {
      return c.json(
        { error: "maxDurationSeconds and idleTimeoutSeconds must be integers from 1 to 86400" },
        400,
      );
    }
    const room: Room = {
      id: `rm_${randomBytes(12).toString("base64url")}`,
      hostUserId,
      hostDisplayName,
      agent: agent as AgentMode,
      agentName,
      sensitive: body.sensitive === true,
      ...(body.anyoneCanAddAgent === true ? { anyoneCanAddAgent: true } : {}),
      ...(maxDurationSeconds ? { maxDurationSeconds } : {}),
      ...(idleTimeoutSeconds ? { idleTimeoutSeconds } : {}),
      metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
      ...(body.mcp ? { mcp: { ownerId: hostUserId, ...(body.mcp as object) } } : {}),
      createdAt: now().toISOString(),
      ...(deps.livekitUrl ? { livekitUrl: deps.livekitUrl } : {}),
      productKeyId: apiKeyId(/^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? ""),
    };
    await storage.createRoom(room);
    if (room.productKeyId) await stats.seeUser(room.productKeyId, hostUserId);
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
    const lkCap = await usage.checkLivekit(room);
    if (lkCap) return c.json(livekitCapBody(lkCap), 402);
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
    const url = room.livekitUrl ?? deps.livekitUrl;
    return c.json({ token, roomId, expiresIn: ttl, ...(url ? { livekitUrl: url } : {}) });
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

  // ---- Call history, retention and delete (T19) ----

  const retentionOf = (room: Room) => room.retention ?? DEFAULT_RETENTION;

  /** The calls this person was in that have saved history. */
  v1.get("/history", async (c) => {
    const actor = str(c.req.query("actorUserId"), MAX_ID);
    if (!actor) return c.json({ error: "actorUserId is required" }, 400);
    const histories = await storage.listHistories(await storage.listRoomIdsForUser(actor));
    const calls = [];
    for (const h of histories) {
      const room = await storage.getRoom(h.roomId);
      if (!room) continue;
      const participant = await storage.getParticipant(room.id, actor);
      if (
        !canReadHistory({
          room,
          history: h,
          participant,
          viewer: { kind: "user", userId: actor },
          now: now(),
        })
      )
        continue;
      calls.push(toListItem(h, retentionOf(room)));
    }
    calls.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    return c.json({ calls });
  });

  v1.get("/history/:id", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    const actor = str(c.req.query("actorUserId"), MAX_ID);
    if (!actor) return c.json({ error: "actorUserId is required" }, 400);
    const history = room ? await storage.getHistory(room.id) : null;
    if (
      !room ||
      !history ||
      !canReadHistory({
        room,
        history,
        participant: await storage.getParticipant(room.id, actor),
        viewer: { kind: "user", userId: actor },
        now: now(),
      })
    ) {
      // Same answer whether the call exists or not, so ids cannot be probed.
      return c.json({ error: "history not found" }, 404);
    }
    return c.json({
      ...history,
      retention: retentionOf(room),
      expiresAt: toListItem(history, retentionOf(room)).expiresAt,
    });
  });

  /** Host: delete everything stored for this call, any time (also after the room ended). */
  v1.delete("/history/:id", async (c) => {
    const room = await hostRoom(c, null, { allowEnded: true });
    if (room instanceof Response) return room;
    const existed = await deleteCallHistory(storage, room.id);
    return c.json({ roomId: room.id, deleted: true, existed });
  });

  /** Host: save notes on or off, and how long history is kept. */
  v1.put("/rooms/:id/history-settings", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await hostRoom(c, body, { allowEnded: true });
    if (room instanceof Response) return room;
    if (body.saveNotes !== undefined && typeof body.saveNotes !== "boolean") {
      return c.json({ error: "saveNotes must be true or false" }, 400);
    }
    if (body.retention !== undefined && !isRetention(body.retention)) {
      return c.json({ error: 'retention must be "30d", "1y" or "forever"' }, 400);
    }
    const next: Room = {
      ...room,
      ...(body.saveNotes !== undefined ? { saveNotes: body.saveNotes } : {}),
      ...(body.retention !== undefined ? { retention: body.retention } : {}),
    };
    await storage.updateRoom(next);
    return c.json({ saveNotes: next.saveNotes ?? false, retention: retentionOf(next) });
  });

  // Which of the host's saved MCP servers are on in this room. Applies the next time the agent
  // joins. `enabledConnectionIds: null` means all saved servers.
  v1.get("/rooms/:id/mcp-servers", async (c) => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, actorOf(c, null));
    if (role instanceof Response) return role;
    return c.json({ enabledConnectionIds: enabledConnectionIds(room) });
  });

  v1.put("/rooms/:id/mcp-servers", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    const ids = body.enabledConnectionIds;
    if (ids !== null && !(Array.isArray(ids) && ids.every((x) => typeof x === "string"))) {
      return c.json({ error: "enabledConnectionIds must be a list of ids or null" }, 400);
    }
    const rest = { ...room.mcp };
    delete rest.enabledConnectionIds;
    await storage.updateRoom({
      ...room,
      mcp: { ownerId: room.hostUserId, ...rest, ...(ids ? { enabledConnectionIds: ids } : {}) },
    });
    return c.json({ enabledConnectionIds: ids });
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

  // The agent state, the "anyone can add" setting and the idle timeout. Host only.
  v1.put("/rooms/:id/agent", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    if (body.agent !== undefined && !AGENT_MODES.includes(body.agent as AgentMode)) {
      return c.json({ error: "agent must be one of on, off, ask" }, 400);
    }
    if (body.anyoneCanAddAgent !== undefined && typeof body.anyoneCanAddAgent !== "boolean") {
      return c.json({ error: "anyoneCanAddAgent must be a boolean" }, 400);
    }
    const idle = body.idleTimeoutSeconds;
    if (
      idle !== undefined &&
      idle !== null &&
      !(typeof idle === "number" && Number.isInteger(idle) && idle > 0 && idle <= 86_400)
    ) {
      return c.json({ error: "idleTimeoutSeconds must be an integer from 1 to 86400" }, 400);
    }
    let next: Room = { ...room };
    if (typeof body.anyoneCanAddAgent === "boolean")
      next.anyoneCanAddAgent = body.anyoneCanAddAgent;
    if (idle === null) delete next.idleTimeoutSeconds;
    else if (typeof idle === "number") next.idleTimeoutSeconds = idle;
    await storage.updateRoom(next);
    let result: { status: string; missing?: unknown } | null = null;
    if (body.agent === "on") {
      const r = await bringIn(next);
      next = r.room;
      result = r.result;
    } else if (body.agent === "off" || body.agent === "ask") {
      next = await sendOut(next, body.agent);
    } else {
      await livekit.updateRoomMetadata(room.id, roomMetadataJson(next));
    }
    return c.json({ ...publicRoom(next), ...(result ? { agentStatus: result } : {}) });
  });

  // ---- Settings endpoints ----

  v1.get("/rooms/:id/settings", async (c) => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, str(c.req.query("viewerUserId"), MAX_ID));
    if (role instanceof Response) return role;
    return c.json(
      await settingsView({ room, userId: room.hostUserId, productKeyId: room.productKeyId }),
    );
  });

  v1.put("/rooms/:id/settings", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    const parsed = parsePatch(body.settings ?? {}, { roomLevel: true });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const r = await applyRoomPatch(room, parsed.patch);
    if (!r.ok) return fail(c, r);
    return c.json(
      await settingsView({
        room: r.room,
        userId: r.room.hostUserId,
        productKeyId: r.room.productKeyId,
      }),
    );
  });

  // Product level: the default for every user of this API key.
  v1.get("/product/settings", async (c) =>
    c.json(await settingsView({ productKeyId: keyIdOf(c), owner: true })),
  );
  v1.put("/product/settings", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const parsed = parsePatch(body.settings ?? {}, { roomLevel: false, productLevel: true });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    const pid = keyIdOf(c);
    if (parsed.patch.llm) {
      const u = await llmUsable(keyUsability, parsed.patch.llm.provider, { productKeyId: pid });
      if (!u.ok) return c.json({ error: u.message, code: u.code }, 409);
    }
    await storage.putSettings(
      `product:${pid}`,
      applyProductPatch(await storage.getSettings(`product:${pid}`), parsed.patch),
    );
    return c.json(await settingsView({ productKeyId: pid, owner: true }));
  });

  // The settings MCP server. The agent worker or a host backend may call it; both are trusted
  // to name the acting user. Changes are two steps: propose, then confirm with the token.
  const asText = (r: unknown): ToolOutcome => ({ text: JSON.stringify(r) });
  const mcpRoom = async (
    roomId: string,
    actor: string,
  ): Promise<{ error: string } | { room: Room; isHost: boolean }> => {
    const room = await storage.getRoom(roomId);
    if (!room) return { error: "room not found" };
    if (room.endedAt) return { error: "room has ended" };
    const isHost = actor === room.hostUserId;
    const p = isHost ? null : await storage.getParticipant(room.id, actor);
    if (!isHost && (!p || p.removedAt)) return { error: "not a participant of this room" };
    return { room, isHost };
  };
  /**
   * The tools for one caller. `bearer` is their token: only a product API key that made the
   * room is the product owner. The agent worker (and so an end user) never is.
   */
  const settingsOpsFor = (bearer: string): SettingsToolOps => {
    const ownsRoom = (room: Room) =>
      isValidApiKey(bearer, deps.apiKeys) &&
      !!room.productKeyId &&
      apiKeyId(bearer) === room.productKeyId;
    return {
      async get({ roomId, actorUserId }: { roomId: string; actorUserId: string }) {
        const r = await mcpRoom(roomId, actorUserId);
        if ("error" in r) return { text: r.error, isError: true };
        return asText(
          await settingsView({
            room: r.room,
            userId: r.room.hostUserId,
            productKeyId: r.room.productKeyId,
            owner: ownsRoom(r.room),
          }),
        );
      },
      async propose({
        roomId,
        actorUserId,
        change,
      }: {
        roomId: string;
        actorUserId: string;
        change: Record<string, unknown>;
      }) {
        const r = await mcpRoom(roomId, actorUserId);
        if ("error" in r) return { text: r.error, isError: true };
        const owner = ownsRoom(r.room);
        const parsed = parsePatch(change, { roomLevel: true, productLevel: owner });
        if (!parsed.ok) return { text: parsed.error, isError: true };
        if (isRoomPatch(parsed.patch) && !r.isHost) {
          return { text: "only the host can change settings", isError: true };
        }
        if (parsed.patch.llm) {
          const u = await llmUsable(keyUsability, parsed.patch.llm.provider, {
            ownerId: r.room.hostUserId,
            productKeyId: r.room.productKeyId,
          });
          if (!u.ok) return { text: u.message, isError: true };
        }
        const { token, expiresAt } = signer.sign(
          { roomId, actor: actorUserId, patch: parsed.patch },
          now().getTime(),
        );
        const question = `Do you want me to ${describePatch(parsed.patch)}?`;
        return asText({
          status: "needs_confirmation",
          question,
          confirmationToken: token,
          expiresAt,
          note: "Nothing has changed yet. Ask the question out loud and only apply it after a yes.",
        });
      },
      async confirm({
        roomId,
        actorUserId,
        confirmationToken,
      }: {
        roomId: string;
        actorUserId: string;
        confirmationToken: string;
      }) {
        const pending = signer.open(confirmationToken, now().getTime());
        if (!pending || pending.roomId !== roomId || pending.actor !== actorUserId) {
          return {
            text: "that confirmation is not valid or has expired; propose the change again",
            isError: true,
          };
        }
        const r = await mcpRoom(roomId, actorUserId);
        if ("error" in r) return { text: r.error, isError: true };
        if (isRoomPatch(pending.patch) && !r.isHost) {
          return { text: "only the host can change settings", isError: true };
        }
        if (isProductPatch(pending.patch) && !ownsRoom(r.room)) {
          return { text: "only the product owner can change who pays", isError: true };
        }
        const applied = await applyRoomPatch(r.room, pending.patch);
        if (!applied.ok) return { text: applied.error, isError: true };
        return asText({
          status: "changed",
          changed: describePatch(pending.patch),
          note: pending.patch.llm
            ? "A model change applies the next time the agent joins the call."
            : isProductPatch(pending.patch)
              ? "Who pays and the caps apply from the next voice start; calls in progress finish."
              : undefined,
        });
      },
    };
  };
  const mcp = new Hono();
  mcp.use("*", async (c, next) => {
    const m = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "");
    const token = m?.[1] ?? "";
    const ok =
      isValidApiKey(token, deps.apiKeys) ||
      (!!deps.agentSecret && isValidApiKey(token, [deps.agentSecret]));
    if (!ok) return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  mcp.route(
    "/",
    settingsMcpApp((c) =>
      settingsOpsFor(/^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "")?.[1] ?? ""),
    ),
  );
  app.route("/mcp/settings", mcp);

  /**
   * Tapped or app-side approval of a write action the agent is waiting on.
   * Only the owner of the tool credentials may approve: the host, or a member
   * named as `ownerId` of one of the room's MCP servers. The server forwards the
   * decision to the agent, which checks it again against the pending action.
   */
  v1.post("/rooms/:id/approvals/:approvalId", async (c) => {
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    if (room.endedAt) return c.json({ error: "room has ended" }, 409);
    const actor = actorOf(c, body);
    const role = await roleOf(c, room, actor);
    if (role instanceof Response) return role;
    if (role === "guest" || !actor || !toolOwners(room).has(actor)) {
      return c.json({ error: "only the owner of the tool credentials can approve" }, 403);
    }
    if (typeof body.approve !== "boolean") {
      return c.json({ error: "approve must be a boolean" }, 400);
    }
    const approvalId = str(c.req.param("approvalId"), MAX_ID);
    if (!approvalId) return c.json({ error: "approvalId is required" }, 400);
    await livekit.sendData(
      room.id,
      APPROVAL_DECISION_TOPIC,
      JSON.stringify({ approvalId, approve: body.approve, actorUserId: actor }),
    );
    return c.json({ approvalId, approve: body.approve, forwarded: true }, 202);
  });

  // ---- Consent ----

  const consentState = async (room: Room) => {
    const participants = await activeParticipants(room.id);
    const consents = await storage.listConsents(room.id);
    // Late consent: when the agent was brought in, earlier consent no longer counts.
    const since = room.agentConsentSince ? Date.parse(room.agentConsentSince) : 0;
    const ok = new Set(
      consents
        .filter((x) => x.textVersion === CONSENT_VERSION && Date.parse(x.consentedAt) >= since)
        .map((x) => x.userId),
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
    // The last missing consent starts the agent that was waiting for it.
    const fresh = await storage.getRoom(room.id);
    if (fresh?.agent === "on" && fresh.agentAwaitingConsent && !fresh.endedAt) {
      await tryStartAgent(fresh).catch(() => undefined);
    }
    return c.json({ roomId: room.id, userId, textVersion: CONSENT_VERSION, consentedAt });
  });

  // ---- Optional agent per room (T18) ----

  /**
   * Check the caps and keys, wake the worker and dispatch the agent. Used by tap-to-start and
   * by bringing the agent in. Nothing reaches STT, LLM or TTS before this succeeds.
   */
  const startAgent = async (
    room: Room,
  ): Promise<
    | { ok: true; dispatchId: string; created: boolean }
    | { ok: false; status: 402 | 401 | 403 | 409 | 429; body: Record<string, unknown> }
  > => {
    const members = (await storage.listParticipants(room.id))
      .filter((p) => !p.removedAt)
      .map((p) => p.userId);
    const lkCap = await usage.checkLivekit(room);
    if (lkCap) return { ok: false, status: 402, body: livekitCapBody(lkCap) };
    const capped = await usage.checkStart(room, members, await productUserCap(room));
    if (capped) {
      return {
        ok: false,
        status: 429,
        body: { error: "A monthly minute cap is reached. Try again next month.", code: capped },
      };
    }
    // With no key modes configured the worker uses its own environment keys.
    const keys = keyModesConfigured ? await resolve(room) : { ok: true as const };
    if (!keys.ok) {
      return {
        ok: false,
        status: refusalStatus[keys.code],
        body: refusalBody(keys),
      };
    }
    // Make sure the worker is up (cold start); the call works as a plain room until it joins.
    await worker.wake().catch(() => false);
    const r = await livekit.dispatchAgent(
      room.id,
      await dispatchMetadata(room, await settingsForAgent(room)),
    );
    return { ok: true, ...r };
  };

  /** Dispatch once everyone has consented; clears the waiting flag when it does. */
  const tryStartAgent = async (
    room: Room,
  ): Promise<{ status: "on" | "awaiting_consent"; missing?: unknown }> => {
    const { missing } = await consentState(room);
    if (missing.length > 0) {
      return {
        status: "awaiting_consent",
        missing: missing.map((p) => ({ userId: p.userId, displayName: p.displayName })),
      };
    }
    const r = await startAgent(room);
    if (!r.ok) throw Object.assign(new Error(String(r.body.error)), { refusal: r });
    const updated: Room = { ...room };
    delete updated.agentAwaitingConsent;
    await storage.updateRoom(updated);
    await livekit.updateRoomMetadata(room.id, roomMetadataJson(updated));
    return { status: "on" };
  };

  /**
   * Flip the room to `on`. The first time, every participant is asked for consent again and the
   * agent is only dispatched when all of them have accepted; until then nobody is listened to.
   */
  const bringIn = async (
    room: Room,
  ): Promise<{ room: Room; result: { status: string; missing?: unknown } }> => {
    let next = room;
    if (room.agent !== "on") {
      next = {
        ...room,
        agent: "on",
        agentConsentSince: now().toISOString(),
        agentAwaitingConsent: true,
        agentRequests: [],
      };
      await storage.updateRoom(next);
      await livekit.updateRoomMetadata(room.id, roomMetadataJson(next));
    } else if (!room.agentAwaitingConsent && room.agentConsentSince) {
      return { room, result: { status: "on" } };
    }
    try {
      const result = await tryStartAgent(next);
      return { room: (await storage.getRoom(room.id)) ?? next, result };
    } catch (e) {
      // Cap, key or trial refusal: keep the room on but not started; say why.
      const refusal = (e as { refusal?: { body: Record<string, unknown> } }).refusal;
      return {
        room: (await storage.getRoom(room.id)) ?? next,
        result: { status: "refused", ...(refusal?.body ?? {}) },
      };
    }
  };

  /** Flip the room to `off` (or `ask`): the agent leaves and nothing more is listened to. */
  const sendOut = async (room: Room, to: "off" | "ask" = "off"): Promise<Room> => {
    const next: Room = { ...room, agent: to, agentRequests: [] };
    delete next.agentAwaitingConsent;
    await storage.updateRoom(next);
    await livekit.updateRoomMetadata(room.id, roomMetadataJson(next));
    await livekit.stopAgent(room.id).catch(() => undefined);
    return next;
  };

  /** State for the controls: who can change it, what is pending, who has not consented. */
  v1.get("/rooms/:id/agent", async (c) => {
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    const role = await roleOf(c, room, actorOf(c, null));
    if (role instanceof Response) return role;
    const { missing } = await consentState(room);
    return c.json({
      agent: room.agent,
      agentName: room.agentName,
      anyoneCanAddAgent: room.anyoneCanAddAgent === true,
      idleTimeoutSeconds: usage.roomLimits(room).idleTimeoutSeconds,
      awaitingConsent: room.agent === "on" && room.agentAwaitingConsent === true,
      missing:
        room.agent === "on" && room.agentAwaitingConsent
          ? missing.map((p) => ({ userId: p.userId, displayName: p.displayName }))
          : [],
      requests: role === "host" ? (room.agentRequests ?? []) : [],
      canControl: role === "host" || room.anyoneCanAddAgent === true,
    });
  });

  /**
   * Bring the agent in. The host (or anyone, when the room allows it) turns it on; any other
   * participant leaves a request for the host to approve.
   */
  v1.post("/rooms/:id/agent/bring-in", async (c) => {
    const body = (await readBody(c)) ?? {};
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    if (room.endedAt) return c.json({ error: "room has ended" }, 409);
    const actor = actorOf(c, body);
    const role = await roleOf(c, room, actor);
    if (role instanceof Response) return role;
    if (role === "host" || room.anyoneCanAddAgent === true) {
      const r = await bringIn(room);
      return c.json({ ...r.result, agent: r.room.agent });
    }
    if (room.agent === "on") return c.json({ status: "on", agent: "on" });
    const p = await storage.getParticipant(room.id, actor!);
    const pending = room.agentRequests ?? [];
    if (!pending.some((q) => q.userId === actor)) {
      const updated: Room = {
        ...room,
        agentRequests: [
          ...pending,
          {
            id: `ar_${randomBytes(9).toString("base64url")}`,
            userId: actor!,
            displayName: p?.displayName ?? actor!,
            requestedAt: now().toISOString(),
          },
        ],
      };
      await storage.updateRoom(updated);
      await livekit.updateRoomMetadata(room.id, roomMetadataJson(updated));
    }
    return c.json({ status: "requested", agent: room.agent }, 202);
  });

  /** Send the agent out. Host, or anyone when the room allows it. */
  v1.post("/rooms/:id/agent/send-out", async (c) => {
    const body = (await readBody(c)) ?? {};
    const room = await loadRoom(c);
    if (room instanceof Response) return room;
    if (room.endedAt) return c.json({ error: "room has ended" }, 409);
    const role = await roleOf(c, room, actorOf(c, body));
    if (role instanceof Response) return role;
    if (role !== "host" && room.anyoneCanAddAgent !== true) {
      return c.json({ error: "only the host can send the agent out" }, 403);
    }
    const next = await sendOut(room, room.agent === "ask" ? "ask" : "off");
    return c.json({ status: "off", agent: next.agent });
  });

  const answerRequest = (approve: boolean) => async (c: Ctx) => {
    const body = (await readBody(c)) ?? {};
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    const reqs = room.agentRequests ?? [];
    if (!reqs.some((q) => q.id === c.req.param("requestId"))) {
      return c.json({ error: "request not found" }, 404);
    }
    if (approve) {
      const r = await bringIn(room);
      return c.json({ ...r.result, agent: r.room.agent });
    }
    const updated: Room = {
      ...room,
      agentRequests: reqs.filter((q) => q.id !== c.req.param("requestId")),
    };
    await storage.updateRoom(updated);
    await livekit.updateRoomMetadata(room.id, roomMetadataJson(updated));
    return c.json({ status: "declined", agent: updated.agent });
  };
  v1.post("/rooms/:id/agent/requests/:requestId/approve", answerRequest(true));
  v1.post("/rooms/:id/agent/requests/:requestId/decline", answerRequest(false));

  /**
   * Send the agent in (host). Refused while the room is AI off or any current
   * participant has not consented; the host can set the room to AI off instead.
   */
  v1.post("/rooms/:id/agent/dispatch", async (c) => {
    const body = (await readBody(c)) ?? {};
    const room = await hostRoom(c, body);
    if (room instanceof Response) return room;
    if (room.agent === "off") return c.json({ error: "the agent is off in this room" }, 409);
    // `ask` means off until someone invites it: the host asking for it is that invitation.
    const { result } = await bringIn(room);
    if (result.status === "awaiting_consent") {
      return c.json({ error: "not every participant has consented", missing: result.missing }, 409);
    }
    if (result.status === "refused") {
      return c.json(
        { error: (result as { error?: string }).error ?? "the agent was refused" },
        409,
      );
    }
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

  // Q3: a guest reads the history of the call through the invite link, read-only.
  app.get("/v1/invites/:token/history", async (c) => {
    const token = c.req.param("token");
    const blocked = limited(c, token);
    if (blocked) return blocked;
    const invite = await storage.getInviteByTokenHash(sha256(token));
    const room = invite ? await storage.getRoom(invite.roomId) : null;
    const history = room ? await storage.getHistory(room.id) : null;
    if (
      !room ||
      !history ||
      !canReadHistory({
        room,
        history,
        participant: null,
        viewer: { kind: "guest", invite },
        now: now(),
      })
    ) {
      return invalidInvite(c);
    }
    return c.json({
      ...history,
      retention: retentionOf(room),
      expiresAt: toListItem(history, retentionOf(room)).expiresAt,
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
    // Until the agent is brought in nothing is listening, so consent can wait (it is asked again then).
    if (room.agent === "on" && !consented) {
      return c.json({ error: "consent is required to join this room" }, 400);
    }
    const lkCap = await usage.checkLivekit(room);
    if (lkCap) return c.json(livekitCapBody(lkCap), 402);
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
      ...((room.livekitUrl ?? deps.livekitUrl)
        ? { livekitUrl: room.livekitUrl ?? deps.livekitUrl }
        : {}),
    });
  });

  // Tap-to-start: the host app calls this when the user taps to talk to the agent.
  v1.post("/rooms/:id/agent", async (c) => {
    let room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    if (room.agent === "off") return c.json({ error: "agent is off for this room" }, 409);
    if (room.endedAt) return c.json({ error: "room has ended" }, 409);
    // The host's own app asking for the agent is the invitation that turns an `ask` room on.
    if (room.agent === "ask") {
      room = { ...room, agent: "on", agentConsentSince: now().toISOString() };
      await storage.updateRoom(room);
      await livekit.updateRoomMetadata(room.id, roomMetadataJson(room));
    }
    const r = await startAgent(room);
    if (!r.ok) return c.json(r.body, r.status);
    return c.json(
      { roomId: room.id, dispatchId: r.dispatchId, created: r.created },
      r.created ? 201 : 200,
    );
  });

  // Read-only usage log for the host: minutes, STT seconds, TTS characters, tokens and estimated cost.
  v1.get("/rooms/:id/usage", async (c) => {
    const room = await hostRoom(c, null, { allowEnded: true });
    if (room instanceof Response) return room;
    return c.json({
      ...(await usage.roomUsage(room.id)),
      limits: usage.roomLimits(room),
      hostMinutesThisMonth: await usage.hostMinutesThisMonth(room.hostUserId),
      hostMonthlyMinutesCap: usage.limits.hostMonthlyMinutes || null,
      userMonthlyMinutesCap: usage.limits.userMonthlyMinutes || null,
    });
  });

  // Which mode pays for a room, without any key material.
  v1.get("/rooms/:id/key-mode", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const r = await resolve(room);
    if (!r.ok) return c.json(refusalBody(r), refusalStatus[r.code]);
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

    r.get("/settings", async (c) => {
      const userId = ownerOf(c);
      return c.json(await settingsView({ userId, productKeyId: keyIdOf(c) }));
    });
    r.put("/settings", async (c) => {
      const body = await readBody(c);
      if (!body) return c.json({ error: "invalid JSON body" }, 400);
      const parsed = parsePatch(body.settings ?? body, { roomLevel: false });
      if (!parsed.ok) return c.json({ error: parsed.error }, 400);
      const userId = ownerOf(c);
      if (parsed.patch.llm) {
        const u = await llmUsable(keyUsability, parsed.patch.llm.provider, {
          ownerId: userId,
          productKeyId: keyIdOf(c),
        });
        if (!u.ok) return c.json({ error: u.message, code: u.code }, 409);
      }
      await storage.putSettings(
        `user:${userId}`,
        applyPatch(await storage.getSettings(`user:${userId}`), parsed.patch),
      );
      return c.json(await settingsView({ userId, productKeyId: keyIdOf(c) }));
    });
    // Onboarding: which providers, what each needs, and where the user stands.
    r.get("/onboarding", async (c) => {
      const userId = ownerOf(c);
      const pid = keyIdOf(c);
      const saved = new Set(
        (await (deps.keyStore?.list(userId) ?? Promise.resolve([]))).map((k) => k.provider),
      );
      const providers = await Promise.all(
        LLM_NAMES.map(async (id) => {
          const u = await llmUsable(keyUsability, id, { ownerId: userId, productKeyId: pid });
          return {
            id,
            label: llmLabel(id),
            recommended: id === "gemini",
            hasKey: saved.has(id),
            // Keys still to add to use this model with your own keys (speech keys are needed too).
            missingKeys: [...PROVIDERS, id].filter((p) => !saved.has(p)),
            usable: u.ok,
            ...(u.ok ? { keyMode: u.mode } : {}),
            copy: ONBOARDING_COPY[id],
            ...(id === "gemini" ? { keyUrl: GEMINI_KEY_URL } : {}),
          };
        }),
      );
      const trial =
        deps.trial && (await storage.getUser(userId))
          ? await deps.trial.service.status(userId, deviceOf(c))
          : null;
      return c.json({
        intro: ONBOARDING_INTRO,
        providers,
        trial,
        trialAvailable: !!deps.trial,
        dataTerms: DATA_TERMS,
        current: await settingsView({ userId, productKeyId: pid }),
      });
    });
    // Check a key with its vendor before saving it. The key is not stored or logged.
    r.post("/keys/:provider/check", async (c) => {
      const provider = c.req.param("provider");
      if (!isProvider(provider)) return c.json({ error: "unknown provider" }, 400);
      const body = await readBody(c);
      const secret = body ? str(body.key, 500) : null;
      if (!secret) return c.json({ error: "key is a required string" }, 400);
      return c.json({ provider, ...(await checkKey(provider, secret)) });
    });
    // Start the free trial: choose Gemini for this user when they have no model yet.
    r.post("/trial/start", async (c) => {
      const user = ownerOf(c);
      if (!deps.trial) return c.json({ error: "trial is not configured" }, 501);
      if (!(await storage.getUser(user))) return c.json({ error: "sign in required" }, 401);
      const status = await deps.trial.service.status(user, deviceOf(c));
      if (!status.available) return c.json({ error: "the free trial is used up", status }, 402);
      const existing = await storage.getSettings(`user:${user}`);
      if (!existing?.llm) {
        await storage.putSettings(
          `user:${user}`,
          applyPatch(existing, { llm: { provider: "gemini" } }),
        );
      }
      return c.json({ started: true, status });
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
  // Pre-check for the product's own UI: would this user's next voice start need their own key?
  // Same resolution as a real start, without a room. Never returns keys.
  byApiKey.get("/key-status", async (c) => {
    const userId = c.req.param("userId") as string;
    const r = await resolve({
      id: "key-status",
      hostUserId: userId,
      hostDisplayName: "",
      agent: "on",
      agentName: "",
      sensitive: false,
      metadata: {},
      createdAt: new Date().toISOString(),
      productKeyId: keyIdOf(c),
    });
    if (r.ok || !keyModesConfigured) return c.json({ status: "ok" });
    return c.json({
      status: "needs_key",
      ...(r.code === "key_required" ? { reason: r.reason } : {}),
    });
  });
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
  /** Create a standalone call: the user is host and the agent mode is as asked. Used by /calls and the watch. */
  async function startStandaloneCall(
    uid: string,
    displayName: string,
    agent: AgentMode,
    agentName: string,
    enabled?: string[],
  ) {
    const room: Room = {
      id: `rm_${randomBytes(12).toString("base64url")}`,
      hostUserId: uid,
      hostDisplayName: displayName,
      agent,
      agentName,
      sensitive: false,
      metadata: {},
      ...(enabled ? { mcp: { ownerId: uid, enabledConnectionIds: enabled } } : {}),
      createdAt: now().toISOString(),
      ...(deps.livekitUrl ? { livekitUrl: deps.livekitUrl } : {}),
      productKeyId: "standalone",
    };
    await storage.createRoom(room);
    await livekit.createRoom(room.id, roomMetadataJson(room));
    await storage.saveParticipant({
      roomId: room.id,
      userId: uid,
      displayName,
      role: "host",
      joinedAt: room.createdAt,
    });
    const token = await livekit.createToken({
      roomId: room.id,
      userId: uid,
      displayName,
      isHost: true,
      role: "host",
      ttlSeconds: ttl,
    });
    return { room, token };
  }
  // Start a call as the signed-in user: creates the room (the user is host) and returns a join token.
  me.post("/calls", async (c) => {
    const body = (await readBody(c)) ?? {};
    const uid = c.get("uid");
    const displayName = str(body.displayName, MAX_NAME);
    if (!displayName) return c.json({ error: "displayName is required" }, 400);
    const agent = body.agent ?? "on";
    if (!AGENT_MODES.includes(agent as AgentMode)) {
      return c.json({ error: "agent must be one of on, off, ask" }, 400);
    }
    const agentName =
      body.agentName === undefined ? defaultAgentName : str(body.agentName, MAX_NAME);
    if (!agentName) return c.json({ error: "agentName must be a non-empty string" }, 400);
    const enabled = body.mcpConnectionIds;
    if (
      enabled !== undefined &&
      !(Array.isArray(enabled) && enabled.every((x) => typeof x === "string"))
    ) {
      return c.json({ error: "mcpConnectionIds must be a list of ids" }, 400);
    }
    const { room, token } = await startStandaloneCall(
      uid,
      displayName,
      agent as AgentMode,
      agentName,
      enabled as string[] | undefined,
    );
    return c.json(
      {
        roomId: room.id,
        token,
        expiresIn: ttl,
        ...(deps.livekitUrl ? { livekitUrl: deps.livekitUrl } : {}),
      },
      201,
    );
  });
  me.post("/warmup", async (c) => {
    const wait = warmupLimit.check(c.get("uid"));
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
  // Apple Watch bridge (spike T27, behind a flag): a short-lived ticket to open the watch socket for a room the user is in.
  me.post("/watch/ticket", async (c) => {
    if (!deps.watchSecret) return c.json({ error: "not found" }, 404);
    const body = (await readBody(c)) ?? {};
    // No roomId: the watch starts a fresh call with the agent on, hosted by the signed-in user.
    let roomId = str(body.roomId, MAX_ID);
    let displayName: string;
    if (roomId) {
      const member = await storage.getParticipant(roomId, c.get("uid"));
      if (!member) return c.json({ error: "not a participant of this room" }, 403);
      displayName = member.displayName;
    } else {
      if (body.roomId !== undefined) return c.json({ error: "roomId must be a string" }, 400);
      displayName = str(body.displayName, MAX_NAME) ?? "Watch";
      roomId = (await startStandaloneCall(c.get("uid"), displayName, "on", defaultAgentName)).room
        .id;
    }
    const ticket = await signWatchTicket(deps.watchSecret, {
      uid: c.get("uid"),
      roomId,
      displayName,
    });
    return c.json({
      ticket,
      roomId,
      expiresIn: 60,
      protocol: WATCH_PROTOCOL_VERSION,
      ...(deps.watchSocketUrl ? { socketUrl: deps.watchSocketUrl } : {}),
    });
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
    if (!r.ok) return c.json(refusalBody(r), refusalStatus[r.code]);
    return c.json({ mode: r.mode, tier: r.tier, keys: r.keys });
  });
  // The agent was asked by voice to leave: the room goes to `off`, like the host's button.
  internal.post("/rooms/:id/agent-off", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    if (!room.endedAt && room.agent === "on") await sendOut(room, "off");
    return c.json({ agent: "off" });
  });
  internal.post("/rooms/:id/history", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    // Nothing is stored unless the host turned "save notes" on.
    if (!room.saveNotes) return c.json({ saved: false });
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const strs = (v: unknown, n: number, len: number): string[] | null =>
      Array.isArray(v) && v.length <= n && v.every((x) => typeof x === "string" && x.length <= len)
        ? (v as string[])
        : null;
    const timed = <T extends { at: string }>(v: unknown, keys: string[]): T[] | null => {
      if (!Array.isArray(v) || v.length > 20000) return null;
      for (const x of v) {
        if (!isRecord(x) || typeof x.at !== "string") return null;
        if (!keys.every((k) => typeof x[k] === "string" && (x[k] as string).length <= 20000))
          return null;
      }
      return v as T[];
    };
    const participants = strs(body.participants ?? [], 100, MAX_NAME);
    const notes = strs(body.notes ?? [], 1000, 5000);
    const transcript = timed<TranscriptLine>(body.transcript ?? [], ["speaker", "text"]);
    const actionLog = timed<ActionLogEntry>(body.actionLog ?? [], ["text"]);
    const actions = body.actions ?? [];
    if (
      !participants ||
      !notes ||
      !transcript ||
      !actionLog ||
      !Array.isArray(actions) ||
      actions.length > 1000 ||
      !actions.every(
        (a) => isRecord(a) && typeof a.text === "string" && typeof a.done === "boolean",
      )
    ) {
      return c.json({ error: "invalid history" }, 400);
    }
    if (typeof body.summary !== "string" || body.summary.length > 50000) {
      return c.json({ error: "summary is required" }, 400);
    }
    const history: CallHistory = {
      roomId: room.id,
      hostUserId: room.hostUserId,
      hostDisplayName: room.hostDisplayName,
      participants,
      transcript,
      notes,
      actions: actions.map((a) => ({
        text: String(a.text).slice(0, 5000),
        done: a.done as boolean,
        ...(typeof a.owner === "string" ? { owner: a.owner.slice(0, MAX_NAME) } : {}),
      })),
      summary: body.summary,
      language: body.language === "pt" ? "pt" : "en",
      actionLog,
      ...(typeof body.startedAt === "string" ? { startedAt: body.startedAt } : {}),
      savedAt: now().toISOString(),
    };
    await storage.saveHistory(history);
    return c.json({ saved: true, roomId: room.id }, 201);
  });
  internal.post("/rooms/:id/usage", async (c) => {
    const room = await storage.getRoom(c.req.param("id"));
    if (!room) return c.json({ error: "room not found" }, 404);
    const body = await readBody(c);
    if (!body) return c.json({ error: "invalid JSON body" }, 400);
    const seconds = body.seconds ?? 0;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
      return c.json({ error: "seconds must be a number from 0 to 3600" }, 400);
    }
    const nums = (v: unknown, max: number): Record<string, number> | null => {
      if (v === undefined) return {};
      if (!isRecord(v) || Object.keys(v).length > 100) return null;
      const out: Record<string, number> = {};
      for (const [k, n] of Object.entries(v)) {
        if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max) return null;
        out[k.slice(0, MAX_ID)] = n;
      }
      return out;
    };
    const scalar = (v: unknown, max: number) =>
      v === undefined
        ? 0
        : typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max
          ? v
          : null;
    const participantSeconds = nums(body.participantSeconds, 3600 * 100);
    const sttSeconds = nums(body.sttSeconds, 3600 * 100);
    const elapsed = scalar(body.elapsedSeconds, 3600 * 100);
    const idle = scalar(body.idleSeconds, 86_400 * 7);
    const tts = scalar(body.ttsCharacters, 1e7);
    const llmIn = scalar(body.llmInputTokens, 1e9);
    const llmOut = scalar(body.llmOutputTokens, 1e9);
    if (
      !participantSeconds ||
      !sttSeconds ||
      elapsed === null ||
      idle === null ||
      tts === null ||
      llmIn === null ||
      llmOut === null
    ) {
      return c.json({ error: "invalid usage report" }, 400);
    }
    const r = await resolve(room);
    const hosted = r.ok ? r.mode === "trial" : r.code === "trial_exhausted";
    const report: UsageReport = {
      agentSeconds: seconds,
      elapsedSeconds: elapsed,
      idleSeconds: idle,
      participantSeconds,
      sttSeconds,
      ttsCharacters: tts,
      llmInputTokens: llmIn,
      llmOutputTokens: llmOut,
    };
    if (r.ok && r.mode === "product" && room.productKeyId) {
      await stats.productKeySeconds(room.productKeyId, seconds);
    }
    const verdict = await usage.record(room, report, hosted, await productUserCap(room));
    // `product_trial`: seconds on the product's key count against this user's allowance.
    if (
      room.productKeyId &&
      r.ok &&
      r.mode === "product" &&
      (await whoPaysOf(room)) === "product_trial"
    ) {
      const pt = await productTrialCounter.record(
        room.productKeyId,
        room.hostUserId,
        seconds,
        await productTrialSeconds(room.productKeyId),
      );
      return c.json({
        counted: true,
        ...pt,
        available: pt.available && verdict.available,
        stop: verdict.stop ?? (pt.available ? undefined : "trial_used"),
      });
    }
    if (!hosted || !deps.trial) {
      return c.json({ counted: false, available: verdict.available, stop: verdict.stop });
    }
    const dev = typeof room.metadata.deviceId === "string" ? room.metadata.deviceId : undefined;
    const trial = await deps.trial.service.record(room.hostUserId, seconds, dev);
    return c.json({
      counted: true,
      ...trial,
      available: trial.available && verdict.available,
      stop: verdict.stop ?? (trial.available ? undefined : "trial_used"),
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
  // Cloud Scheduler hits this daily with its own secret (not the agent's).
  app.post("/internal/history/cleanup", async (c) => {
    const m = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "");
    if (!deps.cleanupSecret || !m || !isValidApiKey(m[1] as string, [deps.cleanupSecret])) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const removed = await cleanupExpiredHistory(storage, now());
    return c.json({ removed: removed.length });
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
