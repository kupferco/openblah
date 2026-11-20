import type { Storage } from "./types.js";
import { createHash } from "node:crypto";

export interface TrialLimits {
  /** Agent audio seconds per account (default 300). */
  perAccountSeconds: number;
  /** Soft per-device limit across accounts. */
  perDeviceSeconds: number;
  /** Cap across everyone on the hosted key. */
  globalSeconds: number;
}

export const DEFAULT_TRIAL_LIMITS: TrialLimits = {
  perAccountSeconds: 300,
  perDeviceSeconds: 600,
  globalSeconds: 200_000,
};

export type TrialReason = "ok" | "account_used" | "device_limit" | "global_cap";

export interface TrialStatus {
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  /** False when the account, device or global limit is reached. */
  available: boolean;
  reason: TrialReason;
}

const GLOBAL = "global";
const accountId = (u: string) => `account:${u}`;
const deviceId = (d: string) =>
  `device:${createHash("sha256").update(d).digest("hex").slice(0, 32)}`;

/** Trial accounting, counted server-side in seconds the agent speaks and listens. */
export class TrialService {
  constructor(
    private readonly storage: Storage,
    private readonly limits: TrialLimits = DEFAULT_TRIAL_LIMITS,
  ) {}

  async status(userId: string, device?: string): Promise<TrialStatus> {
    const used = await this.storage.getUsage(accountId(userId));
    const remaining = Math.max(0, this.limits.perAccountSeconds - used);
    let reason: TrialReason = "ok";
    if (remaining <= 0) reason = "account_used";
    else if (
      device &&
      (await this.storage.getUsage(deviceId(device))) >= this.limits.perDeviceSeconds
    )
      reason = "device_limit";
    else if ((await this.storage.getUsage(GLOBAL)) >= this.limits.globalSeconds)
      reason = "global_cap";
    return {
      limitSeconds: this.limits.perAccountSeconds,
      usedSeconds: Math.min(used, this.limits.perAccountSeconds),
      remainingSeconds: reason === "ok" ? remaining : 0,
      available: reason === "ok",
      reason,
    };
  }

  async canStart(userId: string, device?: string): Promise<boolean> {
    return (await this.status(userId, device)).available;
  }

  /** Add seconds of agent audio. Seconds beyond the account limit are not charged to the global cap. */
  async record(userId: string, seconds: number, device?: string): Promise<TrialStatus> {
    const before = await this.storage.getUsage(accountId(userId));
    const charge = Math.max(0, Math.min(seconds, this.limits.perAccountSeconds - before));
    if (charge > 0) {
      await this.storage.addUsage(accountId(userId), charge);
      await this.storage.addUsage(GLOBAL, charge);
      if (device) await this.storage.addUsage(deviceId(device), charge);
    }
    return this.status(userId, device);
  }
}

export const DEFAULT_PRODUCT_TRIAL_SECONDS = 300;

export interface ProductTrialStatus {
  limitSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  available: boolean;
}

const productCounter = (productKeyId: string, userId: string) => `ptrial:${productKeyId}:${userId}`;

/**
 * The `product_trial` allowance: seconds of agent audio per user, counted per product (the
 * OpenBlah trial counter above is per account and global). The allowance is read per call, so
 * the owner can change it at any time.
 */
export class ProductTrialService {
  constructor(private readonly storage: Storage) {}

  async status(
    productKeyId: string,
    userId: string,
    limitSeconds: number,
  ): Promise<ProductTrialStatus> {
    const used = await this.storage.getUsage(productCounter(productKeyId, userId));
    const remaining = Math.max(0, limitSeconds - used);
    return {
      limitSeconds,
      usedSeconds: Math.min(used, limitSeconds),
      remainingSeconds: remaining,
      available: remaining > 0,
    };
  }

  /** Add seconds; seconds beyond the allowance are not counted. */
  async record(
    productKeyId: string,
    userId: string,
    seconds: number,
    limitSeconds: number,
  ): Promise<ProductTrialStatus> {
    const before = await this.storage.getUsage(productCounter(productKeyId, userId));
    const charge = Math.max(0, Math.min(seconds, limitSeconds - before));
    if (charge > 0) await this.storage.addUsage(productCounter(productKeyId, userId), charge);
    return this.status(productKeyId, userId, limitSeconds);
  }
}
