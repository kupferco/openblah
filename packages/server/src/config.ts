import { createApp } from "./app.js";
import { parseApiKeys } from "./auth.js";
import { FirestoreStorage } from "./firestore.js";
import { RealLiveKit } from "./livekit.js";
import { MemoryStorage } from "./storage.js";
import type { Storage } from "./types.js";

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
  return createApp({
    storage,
    livekit,
    apiKeys,
    livekitUrl: env.LIVEKIT_URL,
    ...(env.OPENBLAH_INVITE_BASE_URL ? { inviteBaseUrl: env.OPENBLAH_INVITE_BASE_URL } : {}),
    ...(env.OPENBLAH_AGENT_NAME ? { agentName: env.OPENBLAH_AGENT_NAME } : {}),
  });
}
