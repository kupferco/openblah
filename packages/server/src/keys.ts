import { KeyCipher, type Sealed } from "./crypto.js";
import { createHash } from "node:crypto";
import type { Room, Storage } from "./types.js";

export const PROVIDERS = ["gemini", "deepgram", "cartesia"] as const;
export type Provider = (typeof PROVIDERS)[number];
/** Optional extra LLM keys: a user may bring OpenAI or Anthropic to pick them as the model (T17). */
export const EXTRA_KEY_PROVIDERS = ["openai", "claude"] as const;
export type ExtraKeyProvider = (typeof EXTRA_KEY_PROVIDERS)[number];
export type KeyProvider = Provider | ExtraKeyProvider;
export type KeyTier = "free" | "paid";
export type KeyMode = "product" | "byok" | "trial";
export type ProviderKeys = Record<Provider, string> & Partial<Record<ExtraKeyProvider, string>>;

/** A saved BYOK key. The secret is only inside `sealed`. */
export interface StoredKey extends Sealed {
  ownerId: string;
  provider: KeyProvider;
  tier: KeyTier;
  /** The owner confirmed "paid tier, no training" (needed for sensitive rooms). */
  noTrainingConfirmed: boolean;
  createdAt: string;
}

/** What may be shown about a saved key: never the key itself. */
export interface KeyInfo {
  provider: KeyProvider;
  tier: KeyTier;
  noTrainingConfirmed: boolean;
  createdAt: string;
}

export const DATA_TERMS =
  "Sensitive rooms only use paid-tier provider keys whose owner confirmed that the provider does not train on the data. Free-tier keys and the free trial may use audio and text to improve provider models.";

export type Resolution =
  | { ok: true; mode: KeyMode; tier: KeyTier; keys: ProviderKeys }
  | {
      ok: false;
      code: "sensitive_free_tier" | "no_key" | "trial_exhausted" | "sign_in_required";
      message: string;
    };

export function isProvider(v: unknown): v is KeyProvider {
  return (
    typeof v === "string" &&
    ((PROVIDERS as readonly string[]).includes(v) ||
      (EXTRA_KEY_PROVIDERS as readonly string[]).includes(v))
  );
}

/** Short stable id for an API key, so raw keys are never stored on rooms. */
export function apiKeyId(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

const aad = (ownerId: string, provider: KeyProvider) => `${ownerId}|${provider}`;

export function keyInfo(k: StoredKey): KeyInfo {
  return {
    provider: k.provider,
    tier: k.tier,
    noTrainingConfirmed: k.noTrainingConfirmed,
    createdAt: k.createdAt,
  };
}

/** BYOK storage: encrypted at rest, plaintext only returned to server-side callers. */
export class KeyStore {
  constructor(
    private readonly storage: Storage,
    private readonly cipher: KeyCipher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async save(
    ownerId: string,
    provider: KeyProvider,
    secret: string,
    tier: KeyTier,
    noTrainingConfirmed: boolean,
  ): Promise<KeyInfo> {
    const stored: StoredKey = {
      ownerId,
      provider,
      tier,
      noTrainingConfirmed: tier === "paid" && noTrainingConfirmed,
      createdAt: this.now().toISOString(),
      ...this.cipher.seal(secret, aad(ownerId, provider)),
    };
    await this.storage.putKey(stored);
    return keyInfo(stored);
  }

  delete(ownerId: string, provider: KeyProvider): Promise<boolean> {
    return this.storage.deleteKey(ownerId, provider);
  }

  async list(ownerId: string): Promise<KeyInfo[]> {
    return (await this.storage.listKeys(ownerId)).map(keyInfo);
  }

  /** All providers for an owner, or null if any is missing. Server-side use only. */
  async openAll(ownerId: string): Promise<{ keys: ProviderKeys; stored: StoredKey[] } | null> {
    const stored = await this.storage.listKeys(ownerId);
    const keys: Partial<Record<KeyProvider, string>> = {};
    for (const s of stored) keys[s.provider] = this.cipher.open(s, aad(ownerId, s.provider));
    if (!PROVIDERS.every((p) => keys[p])) return null;
    return { keys: keys as ProviderKeys, stored };
  }
}

/** A product's provider keys, configured per API key. */
export interface ProductKeyConfig {
  keys: ProviderKeys;
  tier: KeyTier;
}

/** Parse `{"<apiKey>": {"gemini":"..","deepgram":"..","cartesia":"..","tier":"paid"}}`. `"*"` is the self-hosted default. */
export function parseProductKeys(raw: string | undefined): Record<string, ProductKeyConfig> {
  if (!raw) return {};
  const data = JSON.parse(raw) as Record<string, Record<string, string>>;
  const out: Record<string, ProductKeyConfig> = {};
  for (const [apiKey, cfg] of Object.entries(data)) {
    if (!PROVIDERS.every((p) => typeof cfg[p] === "string" && cfg[p])) {
      throw new Error("product keys need gemini, deepgram and cartesia");
    }
    out[apiKey] = {
      keys: {
        gemini: cfg.gemini!,
        deepgram: cfg.deepgram!,
        cartesia: cfg.cartesia!,
        ...(cfg.openai ? { openai: cfg.openai } : {}),
        ...(cfg.claude ? { claude: cfg.claude } : {}),
      },
      tier: cfg.tier === "free" ? "free" : "paid",
    };
  }
  return out;
}

export interface KeyResolverDeps {
  storage: Storage;
  keyStore: KeyStore | null;
  productKeys: Record<string, ProductKeyConfig>;
  /** Called when neither BYOK nor product keys apply. */
  trial: {
    keys: ProviderKeys | null;
    canStart(room: Room): Promise<"ok" | "sign_in_required" | "exhausted">;
  };
}

/**
 * Choose whose keys pay for a room. In a group room the host's key pays.
 * Order: host BYOK, the product's key for the API key that made the room, trial.
 */
export async function resolveRoomKeys(
  deps: KeyResolverDeps,
  room: Room,
  productKeyId: string | undefined,
): Promise<Resolution> {
  const refuse = (): Resolution => ({
    ok: false,
    code: "sensitive_free_tier",
    message: `This room is sensitive and cannot use a free-tier key. ${DATA_TERMS}`,
  });

  const byok = deps.keyStore ? await deps.keyStore.openAll(room.hostUserId) : null;
  if (byok) {
    const free = byok.stored.some((k) => k.tier === "free");
    const unconfirmed = byok.stored.some((k) => !k.noTrainingConfirmed);
    if (room.sensitive && (free || unconfirmed)) return refuse();
    return { ok: true, mode: "byok", tier: free ? "free" : "paid", keys: byok.keys };
  }

  const product = (productKeyId && deps.productKeys[productKeyId]) || deps.productKeys["*"];
  if (product) {
    if (room.sensitive && product.tier === "free") return refuse();
    return { ok: true, mode: "product", tier: product.tier, keys: product.keys };
  }

  if (!deps.trial.keys) {
    return { ok: false, code: "no_key", message: "No provider keys are configured for this room." };
  }
  if (room.sensitive) return refuse();
  const trial = await deps.trial.canStart(room);
  if (trial === "sign_in_required") {
    return {
      ok: false,
      code: "sign_in_required",
      message: "Sign in to use the free trial, or add your own keys.",
    };
  }
  if (trial === "exhausted") {
    return {
      ok: false,
      code: "trial_exhausted",
      message: "The free trial is used up. Add your own keys to continue.",
    };
  }
  return { ok: true, mode: "trial", tier: "free", keys: deps.trial.keys };
}
