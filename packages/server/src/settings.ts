import { createHmac, timingSafeEqual } from "node:crypto";
import { EXTRA_KEY_PROVIDERS, PROVIDERS, type KeyStore, type ProductKeyConfig } from "./keys.js";

/*
 * The model and language settings (plan 4.1). The model lives at three levels with this
 * precedence: room, then user/product, then the server default. Only a choice of provider and
 * model is stored here; keys are never part of a setting.
 */

export const LLM_NAMES = ["gemini", "openai", "claude"] as const;
export type LlmName = (typeof LLM_NAMES)[number];
export const LANGUAGES = ["en", "pt"] as const;
export type Language = (typeof LANGUAGES)[number];

export interface ModelChoice {
  provider: LlmName;
  model?: string;
}

/** Who pays for voice in a product: its own key, each user's key, or its key up to a trial allowance. */
export const WHO_PAYS = ["product", "user_key", "product_trial"] as const;
export type WhoPays = (typeof WHO_PAYS)[number];
/** A new product starts here (plan 370, Q1). */
export const DEFAULT_WHO_PAYS: WhoPays = "user_key";
export const isWhoPays = (v: unknown): v is WhoPays =>
  typeof v === "string" && (WHO_PAYS as readonly string[]).includes(v);

/** One level of settings. Absent parts fall through to the level below. */
export interface SettingsLevel {
  /** Product level only: who pays for voice. Never read from a room or user level. */
  whoPays?: WhoPays;
  /** Product level only: agent audio seconds each user gets on the product's key in `product_trial` (default 300). */
  trialSeconds?: number;
  llm?: ModelChoice;
  /** Spoken-language override. Absent = follow what people speak. */
  language?: Language;
}

export type ModelSource = "room" | "user" | "product" | "server" | "default";

export const DEFAULT_MODEL: ModelChoice = { provider: "gemini" };

const isLlm = (v: unknown): v is LlmName =>
  typeof v === "string" && (LLM_NAMES as readonly string[]).includes(v);
const isLanguage = (v: unknown): v is Language =>
  typeof v === "string" && (LANGUAGES as readonly string[]).includes(v);

export interface SettingLevels {
  room?: SettingsLevel | null;
  user?: SettingsLevel | null;
  product?: SettingsLevel | null;
  server?: SettingsLevel | null;
}

/** Room beats user/product beats server default. A user's own choice beats the product's. */
export function resolveModel(levels: SettingLevels): { choice: ModelChoice; source: ModelSource } {
  const order: [ModelSource, SettingsLevel | null | undefined][] = [
    ["room", levels.room],
    ["user", levels.user],
    ["product", levels.product],
    ["server", levels.server],
  ];
  for (const [source, level] of order) if (level?.llm) return { choice: level.llm, source };
  return { choice: DEFAULT_MODEL, source: "default" };
}

/** The spoken-language override, by the same precedence. */
export function resolveLanguage(levels: SettingLevels): Language | undefined {
  return (levels.room ?? levels.user ?? levels.product ?? levels.server)?.language;
}

/** A request to change settings. `null` clears a part. */
export interface SettingsPatch {
  llm?: ModelChoice | null;
  language?: Language | null;
  /** Room level only. */
  agentName?: string;
  /** Product level only. */
  whoPays?: WhoPays;
  /** Product level only: per-user trial allowance in seconds (0 to 86400). */
  trialSeconds?: number;
}

const MODEL_ID = /^[\w.:/-]{1,80}$/;

export type PatchResult = { ok: true; patch: SettingsPatch } | { ok: false; error: string };

/**
 * Validate an untrusted change. Accepts `llm` as a provider name or `{provider, model}`;
 * `model` alone is not enough. `language: "auto"` clears the override.
 */
export function parsePatch(
  raw: unknown,
  opts: { roomLevel: boolean; productLevel?: boolean },
): PatchResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "settings must be an object" };
  }
  const r = raw as Record<string, unknown>;
  const patch: SettingsPatch = {};
  if (r.llm !== undefined) {
    if (r.llm === null || r.llm === "default") patch.llm = null;
    else {
      const c =
        typeof r.llm === "string" ? { provider: r.llm, model: r.model } : (r.llm as ModelChoice);
      if (!c || !isLlm(c.provider)) {
        return { ok: false, error: `model provider must be one of ${LLM_NAMES.join(", ")}` };
      }
      if (c.model !== undefined && (typeof c.model !== "string" || !MODEL_ID.test(c.model))) {
        return { ok: false, error: "model name is not valid" };
      }
      patch.llm = { provider: c.provider, ...(c.model ? { model: c.model } : {}) };
    }
  }
  if (r.language !== undefined) {
    if (r.language === null || r.language === "auto") patch.language = null;
    else if (isLanguage(r.language)) patch.language = r.language;
    else return { ok: false, error: "language must be en, pt or auto" };
  }
  if (r.agentName !== undefined) {
    if (!opts.roomLevel) return { ok: false, error: "agentName can only be set on a room" };
    if (typeof r.agentName !== "string" || !r.agentName.trim() || r.agentName.length > 100) {
      return { ok: false, error: "agentName must be a non-empty string" };
    }
    patch.agentName = r.agentName.trim();
  }
  if (r.whoPays !== undefined) {
    if (!opts.productLevel) {
      return { ok: false, error: "whoPays can only be set by the product owner" };
    }
    if (!isWhoPays(r.whoPays)) {
      return { ok: false, error: `whoPays must be one of ${WHO_PAYS.join(", ")}` };
    }
    patch.whoPays = r.whoPays;
  }
  if (r.trialSeconds !== undefined) {
    if (!opts.productLevel) {
      return { ok: false, error: "trialSeconds can only be set by the product owner" };
    }
    const t = r.trialSeconds;
    if (typeof t !== "number" || !Number.isInteger(t) || t < 0 || t > 86_400) {
      return { ok: false, error: "trialSeconds must be a whole number from 0 to 86400" };
    }
    patch.trialSeconds = t;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "nothing to change" };
  return { ok: true, patch };
}

export function applyPatch(level: SettingsLevel | null | undefined, patch: SettingsPatch) {
  const next: SettingsLevel = { ...level };
  if (patch.llm === null) delete next.llm;
  else if (patch.llm) next.llm = patch.llm;
  if (patch.language === null) delete next.language;
  else if (patch.language) next.language = patch.language;
  if (patch.whoPays) next.whoPays = patch.whoPays;
  if (patch.trialSeconds !== undefined) next.trialSeconds = patch.trialSeconds;
  return next;
}

const LABEL: Record<LlmName, string> = { gemini: "Gemini", openai: "OpenAI", claude: "Claude" };
export const llmLabel = (p: LlmName) => LABEL[p];

/** One plain sentence for a confirmation ("switch the model to Claude"). */
export function describePatch(patch: SettingsPatch): string {
  const parts: string[] = [];
  if (patch.llm === null) parts.push("go back to the default model");
  else if (patch.llm) {
    parts.push(
      `switch the model to ${LABEL[patch.llm.provider]}${patch.llm.model ? ` (${patch.llm.model})` : ""}`,
    );
  }
  if (patch.language === null) parts.push("follow the language people speak");
  else if (patch.language)
    parts.push(`speak ${patch.language === "pt" ? "Portuguese" : "English"}`);
  if (patch.whoPays) parts.push(`set who pays to ${patch.whoPays}`);
  if (patch.trialSeconds !== undefined) {
    parts.push(`set the free trial to ${Math.round(patch.trialSeconds / 6) / 10} minutes per user`);
  }
  if (patch.agentName) parts.push(`rename the agent to ${patch.agentName}`);
  return parts.join(" and ");
}

// ---- Key usability ----

export interface KeyUsabilityDeps {
  /** False when no key mode is configured: the worker then uses its own environment keys. */
  keyModesConfigured: boolean;
  keyStore: KeyStore | null;
  productKeys: Record<string, ProductKeyConfig>;
  /** The hosted trial key set is configured (it covers Gemini only). */
  trialConfigured: boolean;
}

export type Usability =
  | { ok: true; mode: "server" | "byok" | "product" | "trial" }
  | { ok: false; code: "no_key"; message: string };

export const GEMINI_KEY_URL = "https://aistudio.google.com/apikey";

/**
 * Can this provider run for this owner? BYOK needs the whole key set (as for any room) plus a
 * key for the chosen provider; a product key set may include one; the trial covers Gemini only.
 */
export async function llmUsable(
  deps: KeyUsabilityDeps,
  provider: LlmName,
  ctx: { ownerId?: string; productKeyId?: string },
): Promise<Usability> {
  if (!deps.keyModesConfigured) return { ok: true, mode: "server" };
  if (deps.keyStore && ctx.ownerId) {
    const have = new Set((await deps.keyStore.list(ctx.ownerId)).map((k) => k.provider));
    if (PROVIDERS.every((p) => have.has(p)) && have.has(provider))
      return { ok: true, mode: "byok" };
  }
  const product = (ctx.productKeyId && deps.productKeys[ctx.productKeyId]) || deps.productKeys["*"];
  if (product?.keys[provider]) return { ok: true, mode: "product" };
  if (provider === "gemini" && deps.trialConfigured) return { ok: true, mode: "trial" };
  const message =
    provider === "gemini"
      ? `There is no Gemini key yet. Get a free key at ${GEMINI_KEY_URL}, or start the free trial.`
      : `Add your own ${LABEL[provider]} key first. Gemini works with a free key.`;
  return { ok: false, code: "no_key", message };
}

export const EXTRA_LLM_KEYS: readonly string[] = EXTRA_KEY_PROVIDERS;

// ---- Confirmation tokens (stateless, so any server instance can confirm) ----

const CONFIRM_TTL_MS = 2 * 60_000;

interface Pending {
  roomId: string;
  actor: string;
  patch: SettingsPatch;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Signs a proposed change so it can only be applied by the same person, in the same room, soon. */
export class ConfirmationSigner {
  constructor(private readonly secret: string) {}

  private sig(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }

  sign(p: Omit<Pending, "exp">, nowMs: number): { token: string; expiresAt: string } {
    const exp = nowMs + CONFIRM_TTL_MS;
    const payload = b64(JSON.stringify({ ...p, exp }));
    return { token: `${payload}.${this.sig(payload)}`, expiresAt: new Date(exp).toISOString() };
  }

  open(token: string, nowMs: number): Pending | null {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const want = Buffer.from(this.sig(payload));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
    try {
      const p = JSON.parse(Buffer.from(payload, "base64url").toString()) as Pending;
      return p.exp > nowMs ? p : null;
    } catch {
      return null;
    }
  }
}
