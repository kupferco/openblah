import type { KeyInfo, KeyTier, Provider } from "./keys.js";
import type { TrialStatus } from "./trial.js";

export interface ServerClientOptions {
  /** Base URL of the OpenBlah server. */
  baseUrl: string;
  /**
   * Bearer credential: the product's API key (then pass `userId`), or a
   * Firebase ID token for the standalone app's own user (leave `userId` out).
   */
  token: string;
  /** The user the product vouches for. Only with an API key. */
  userId?: string;
  /** Stable per-install ID for the best-effort per-device trial limit. */
  deviceId?: string;
  fetch?: typeof fetch;
}

/** Typed calls for the key and trial endpoints. 0.x, unstable. */
export class OpenBlahServerClient {
  constructor(private readonly o: ServerClientOptions) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const base = this.o.userId ? `/v1/users/${encodeURIComponent(this.o.userId)}` : "/v1/me";
    const res = await (this.o.fetch ?? fetch)(
      `${this.o.baseUrl.replace(/\/$/, "")}${base}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${this.o.token}`,
          "Content-Type": "application/json",
          ...(this.o.deviceId ? { "X-OpenBlah-Device": this.o.deviceId } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data as T;
  }

  /** Save your own provider key. It is stored encrypted and never returned. */
  saveKey(
    provider: Provider,
    key: string,
    opts: { tier: KeyTier; noTrainingConfirmed?: boolean },
  ): Promise<KeyInfo> {
    return this.call("PUT", `/keys/${provider}`, { key, ...opts });
  }

  /** Delete a saved key. */
  async deleteKey(provider: Provider): Promise<void> {
    await this.call("DELETE", `/keys/${provider}`);
  }

  async listKeys(): Promise<KeyInfo[]> {
    return (await this.call<{ keys: KeyInfo[] }>("GET", "/keys")).keys;
  }

  /** Remaining free trial for the signed-in account. */
  getTrialStatus(): Promise<TrialStatus> {
    return this.call("GET", "/trial");
  }
}
