import type { KeyProvider } from "./keys.js";

/** Result of asking a vendor whether a key works. `unchecked` = no cheap check exists. */
export type KeyCheck = { status: "valid" | "invalid" | "unchecked" | "unreachable" };

export type KeyChecker = (provider: KeyProvider, key: string) => Promise<KeyCheck>;

/**
 * Checks a key with a free "list models" style call. The key goes only to the vendor's own
 * fixed URL, in a header, and is never logged or stored by this check.
 */
export function vendorKeyChecker(fetchFn: typeof fetch = fetch): KeyChecker {
  const requests: Partial<Record<KeyProvider, [string, Record<string, string>]>> = {
    gemini: [
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      { "x-goog-api-key": "" },
    ],
    openai: ["https://api.openai.com/v1/models", { Authorization: "Bearer " }],
    claude: [
      "https://api.anthropic.com/v1/models?limit=1",
      { "x-api-key": "", "anthropic-version": "2023-06-01" },
    ],
    deepgram: ["https://api.deepgram.com/v1/auth/token", { Authorization: "Token " }],
  };
  return async (provider, key) => {
    const r = requests[provider];
    if (!r) return { status: "unchecked" };
    const headers: Record<string, string> = {};
    for (const [name, prefix] of Object.entries(r[1])) {
      headers[name] = name === "anthropic-version" ? prefix : `${prefix}${key}`;
    }
    try {
      const res = await fetchFn(r[0], { headers, signal: AbortSignal.timeout(8000) });
      if (res.ok) return { status: "valid" };
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { status: "invalid" };
      }
      return { status: "unreachable" };
    } catch {
      return { status: "unreachable" };
    }
  };
}
