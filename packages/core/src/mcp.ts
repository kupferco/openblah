import type { McpConnection, OpenBlahApi, StartMcpConnectionOptions } from "./api.js";

export interface ConnectMcpServerOptions extends StartMcpConnectionOptions {
  /**
   * Show the consent page: a popup or tab on the web, an in-app browser sheet on
   * mobile. Called once with the authorization URL. Credentials are typed there,
   * never in your UI and never by voice.
   */
  openAuthorization: (authorizationUrl: string) => void | Promise<unknown>;
  /** Return true when the person closed the consent window (checked between polls). */
  isCancelled?: () => boolean;
  /** Poll interval. Default 1500 ms. */
  pollIntervalMs?: number;
  /** Give up after this long. Default 5 minutes. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Mainly for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** Why connecting did not finish. */
export class McpConnectError extends Error {
  constructor(
    readonly reason: "refused" | "cancelled" | "timeout",
    message: string,
    readonly connectionId?: string,
  ) {
    super(message);
    this.name = "McpConnectError";
  }
}

/**
 * Connect an MCP server for a person: start the OAuth flow, show the consent
 * page, then wait for the result. Resolves with the connected server; rejects
 * with {@link McpConnectError} when the person refused, closed the window, or it
 * timed out. A cancelled or timed-out attempt is removed again.
 */
export async function connectMcpServer(
  api: Pick<OpenBlahApi, "startMcpConnection" | "getMcpConnection" | "disconnectMcp">,
  url: string,
  options: ConnectMcpServerOptions,
): Promise<McpConnection> {
  const { openAuthorization, isCancelled, pollIntervalMs = 1500, timeoutMs = 300_000 } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const { userId, name, scope, returnUrl } = options;
  const started = await api.startMcpConnection(url, {
    ...(userId ? { userId } : {}),
    ...(name ? { name } : {}),
    ...(scope ? { scope } : {}),
    ...(returnUrl ? { returnUrl } : {}),
  });
  const giveUp = async (reason: "cancelled" | "timeout", message: string): Promise<never> => {
    await api.disconnectMcp(started.id, userId).catch(() => undefined);
    throw new McpConnectError(reason, message, started.id);
  };
  try {
    await openAuthorization(started.authorizationUrl);
  } catch (e) {
    await api.disconnectMcp(started.id, userId).catch(() => undefined);
    throw e;
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const c = await api.getMcpConnection(started.id, userId);
    if (c.status === "connected") return c;
    if (c.status === "error") {
      throw new McpConnectError("refused", c.error ?? "The sign-in did not finish", started.id);
    }
    if (options.signal?.aborted || isCancelled?.()) {
      return giveUp("cancelled", "The sign-in window was closed");
    }
    if (Date.now() >= deadline) return giveUp("timeout", "The sign-in took too long");
    await sleep(pollIntervalMs);
  }
}
