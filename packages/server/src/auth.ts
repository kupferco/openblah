import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time check of a presented key against all configured keys. */
export function isValidApiKey(presented: string, keys: readonly string[]): boolean {
  const p = digest(presented);
  let ok = false;
  // No early exit, so timing does not reveal which key matched.
  for (const key of keys) {
    if (timingSafeEqual(p, digest(key))) ok = true;
  }
  return ok;
}

export function parseApiKeys(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

export function apiKeyAuth(keys: readonly string[]): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer (.+)$/i.exec(header);
    if (!match || !isValidApiKey(match[1] ?? "", keys)) {
      c.header("WWW-Authenticate", "Bearer");
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  };
}
