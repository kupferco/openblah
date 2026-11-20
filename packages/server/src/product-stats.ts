import type { KeyStore } from "./keys.js";
import type { Storage } from "./types.js";

/*
 * What a product owner sees on the settings screen (plan 370, part 3): counts only, never
 * names or keys. Kept in the usage counters, so it survives restarts and is shared by
 * instances. Users marked `isTest` are left out of every count.
 */

const enc = encodeURIComponent;
const DAY_MS = 86_400_000;
export const KEY_REQUIRED_WINDOW_DAYS = 30;
/** Per-user monthly minutes on a product that pays and has not chosen a cap (Q3). */
export const DEFAULT_PRODUCT_USER_MINUTES = 60;

export interface ProductStats {
  /** Users of this product who saved a key of their own. Count only. */
  usersWithOwnKey: number;
  /** Users who were asked for a key (`key_required`) in the last 30 days. */
  keyRequiredUsers30d: number;
  /** Agent minutes this month that the product's key paid for. */
  productKeyMinutesThisMonth: number;
}

export class ProductStatsService {
  constructor(
    private readonly storage: Storage,
    private readonly keyStore: KeyStore | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private day(d = this.now()) {
    return d.toISOString().slice(0, 10);
  }

  /** A person used this product (hosted a room). Idempotent in effect: only presence counts. */
  async seeUser(productId: string, userId: string): Promise<void> {
    const id = `pstat:${enc(productId)}:user:${enc(userId)}`;
    if ((await this.storage.getUsage(id)) === 0) await this.storage.addUsage(id, 1);
  }

  /** A person was refused with `key_required`. One mark per person per day. */
  async keyRequired(productId: string, userId: string): Promise<void> {
    const id = `pstat:${enc(productId)}:keyreq:${this.day()}:${enc(userId)}`;
    if ((await this.storage.getUsage(id)) === 0) await this.storage.addUsage(id, 1);
  }

  /** Seconds of agent audio the product's key paid for. */
  async productKeySeconds(productId: string, seconds: number): Promise<void> {
    if (seconds > 0) {
      await this.storage.addUsage(
        `pstat:${enc(productId)}:minutes:${this.now().toISOString().slice(0, 7)}`,
        seconds,
      );
    }
  }

  private async isTest(userId: string): Promise<boolean> {
    return (await this.storage.getUser(userId))?.isTest === true;
  }

  async summary(productId: string): Promise<ProductStats> {
    const p = `pstat:${enc(productId)}:`;
    const all = await this.storage.listUsage(p);
    const month = this.now().toISOString().slice(0, 7);

    let usersWithOwnKey = 0;
    const cutoff = this.day(new Date(this.now().getTime() - KEY_REQUIRED_WINDOW_DAYS * DAY_MS));
    const asked = new Set<string>();
    for (const id of Object.keys(all)) {
      const rest = id.slice(p.length);
      if (rest.startsWith("user:")) {
        const userId = decodeURIComponent(rest.slice(5));
        if (this.keyStore && (await this.keyStore.list(userId)).length > 0) {
          if (!(await this.isTest(userId))) usersWithOwnKey++;
        }
      } else if (rest.startsWith("keyreq:")) {
        const [day, user] = rest.slice(7).split(":");
        if (day && user && day >= cutoff) asked.add(decodeURIComponent(user));
      }
    }
    let keyRequiredUsers30d = 0;
    for (const u of asked) if (!(await this.isTest(u))) keyRequiredUsers30d++;
    return {
      usersWithOwnKey,
      keyRequiredUsers30d,
      productKeyMinutesThisMonth: Math.round(((all[`${p}minutes:${month}`] ?? 0) / 60) * 10) / 10,
    };
  }
}
