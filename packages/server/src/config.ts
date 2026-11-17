import { FirebaseTokenVerifier } from "./accounts.js";
import { createApp } from "./app.js";
import { parseApiKeys } from "./auth.js";
import { FirestoreStorage } from "./firestore.js";
import { KeyCipher } from "./crypto.js";
import { apiKeyId, KeyStore, parseProductKeys, type ProviderKeys } from "./keys.js";
import { RealLiveKit } from "./livekit.js";
import { HttpWorkerWaker } from "./worker.js";
import { MemoryStorage } from "./storage.js";
import { DEFAULT_TRIAL_LIMITS, TrialService } from "./trial.js";
import type { Storage } from "./types.js";
import { DEFAULT_LIMITS, parsePrices, UsageService, webhookNotifier } from "./usage.js";

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

/** Build the app from environment variables. Throws on missing config. */
export function createAppFromEnv(env: Env = process.env) {
  const apiKeys = parseApiKeys(env.OPENBLAH_API_KEYS);
  if (apiKeys.length === 0) throw new Error("OPENBLAH_API_KEYS must list at least one key");
  const livekit = new RealLiveKit({
    url: required(env, "LIVEKIT_URL"),
    apiKey: required(env, "LIVEKIT_API_KEY"),
    apiSecret: required(env, "LIVEKIT_API_SECRET"),
    agentName: env.OPENBLAH_AGENT_DISPATCH_NAME || undefined,
  });
  const kind = env.OPENBLAH_STORAGE ?? "memory";
  let storage: Storage;
  if (kind === "firestore") storage = new FirestoreStorage();
  else if (kind === "memory") storage = new MemoryStorage();
  else throw new Error(`OPENBLAH_STORAGE must be "memory" or "firestore", got "${kind}"`);

  const num = (name: string, fallback: number) => {
    const v = env[name];
    if (!v) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
    return n;
  };

  // BYOK needs the encryption secret; without it the key endpoints answer 501.
  const keyStore = env.KEY_ENCRYPTION_SECRET
    ? new KeyStore(storage, new KeyCipher(env.KEY_ENCRYPTION_SECRET))
    : undefined;

  // Product keys: per API key (JSON), plus the self-hosted default from the plain provider variables.
  const productKeys: Record<string, ReturnType<typeof parseProductKeys>[string]> = {};
  for (const [rawKey, cfg] of Object.entries(parseProductKeys(env.OPENBLAH_PRODUCT_KEYS))) {
    productKeys[rawKey === "*" ? "*" : apiKeyId(rawKey)] = cfg;
  }
  if (!productKeys["*"] && env.OPENBLAH_SELF_HOSTED === "true") {
    const keys = providerKeysFrom(env.GEMINI_API_KEY, env.DEEPGRAM_API_KEY, env.CARTESIA_API_KEY);
    if (!keys)
      throw new Error(
        "OPENBLAH_SELF_HOSTED needs GEMINI_API_KEY, DEEPGRAM_API_KEY and CARTESIA_API_KEY",
      );
    productKeys["*"] = { keys, tier: env.OPENBLAH_SELF_HOSTED_TIER === "free" ? "free" : "paid" };
  }

  // Trial on OpenBlah's hosted keys.
  const trialKeys = providerKeysFrom(
    env.OPENBLAH_TRIAL_GEMINI_API_KEY,
    env.OPENBLAH_TRIAL_DEEPGRAM_API_KEY,
    env.OPENBLAH_TRIAL_CARTESIA_API_KEY,
  );
  const trial = trialKeys
    ? {
        keys: trialKeys,
        service: new TrialService(storage, {
          perAccountSeconds: num("OPENBLAH_TRIAL_SECONDS", DEFAULT_TRIAL_LIMITS.perAccountSeconds),
          perDeviceSeconds: num(
            "OPENBLAH_TRIAL_DEVICE_SECONDS",
            DEFAULT_TRIAL_LIMITS.perDeviceSeconds,
          ),
          globalSeconds: num("OPENBLAH_TRIAL_GLOBAL_SECONDS", DEFAULT_TRIAL_LIMITS.globalSeconds),
        }),
      }
    : undefined;

  const verifier = env.FIREBASE_PROJECT_ID
    ? new FirebaseTokenVerifier(env.FIREBASE_PROJECT_ID)
    : undefined;

  const usage = new UsageService(storage, {
    prices: parsePrices(env.OPENBLAH_PRICES),
    monthlyCapGbp: num("OPENBLAH_MONTHLY_CAP_GBP", 50),
    limits: {
      maxRoomSeconds: num("OPENBLAH_MAX_ROOM_SECONDS", DEFAULT_LIMITS.maxRoomSeconds),
      idleTimeoutSeconds: num("OPENBLAH_IDLE_TIMEOUT_SECONDS", DEFAULT_LIMITS.idleTimeoutSeconds),
      userMonthlyMinutes: num("OPENBLAH_USER_MONTHLY_MINUTES", 0),
      hostMonthlyMinutes: num("OPENBLAH_HOST_MONTHLY_MINUTES", 0),
    },
    notify: async (alert) => {
      console.log(JSON.stringify(alert));
      if (env.OPENBLAH_ALERT_WEBHOOK_URL)
        await webhookNotifier(env.OPENBLAH_ALERT_WEBHOOK_URL)(alert);
    },
  });

  return createApp({
    storage,
    usage,
    livekit,
    apiKeys,
    keyStore,
    productKeys,
    trial,
    verifier,
    agentSecret: env.OPENBLAH_AGENT_SECRET || undefined,
    worker: env.AGENT_WORKER_URL
      ? new HttpWorkerWaker(env.AGENT_WORKER_URL, env.AGENT_WORKER_AUTH === "iam")
      : undefined,
    livekitUrl: env.LIVEKIT_URL,
    ...(env.OPENBLAH_INVITE_BASE_URL ? { inviteBaseUrl: env.OPENBLAH_INVITE_BASE_URL } : {}),
    ...(env.OPENBLAH_AGENT_NAME ? { agentName: env.OPENBLAH_AGENT_NAME } : {}),
  });
}

function providerKeysFrom(
  gemini: string | undefined,
  deepgram: string | undefined,
  cartesia: string | undefined,
): ProviderKeys | null {
  return gemini && deepgram && cartesia ? { gemini, deepgram, cartesia } : null;
}
