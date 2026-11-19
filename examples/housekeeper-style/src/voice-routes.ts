/**
 * Housekeeper-style backend routes for OpenBlah voice. Web-standard `Request` -> `Response`, no
 * framework: mount it with `toNodeListener` (Node http / Express) or call it from any fetch-style
 * host (Hono, Cloudflare, Next route handlers).
 *
 * The OpenBlah API key lives only here. The app never sees it.
 */

/** What Housekeeper's own auth tells us about the caller. */
export interface HousekeeperUser {
  id: string;
  displayName: string;
  /** The user's token for Housekeeper's MCP server (what the app already sends to Housekeeper). */
  mcpToken: string;
}

export interface VoiceRoutesOptions {
  /** OpenBlah server base URL, e.g. `https://openblah-server.example.com`. */
  openblahUrl: string;
  /** Your OpenBlah API key (`OPENBLAH_API_KEYS` on the server). Server-side only. */
  openblahApiKey: string;
  /** Housekeeper's MCP server URL. */
  mcpUrl: string;
  /** Resolve the logged-in user from the request (session cookie, bearer token...). null = not logged in. */
  authenticate(req: Request): Promise<HousekeeperUser | null>;
  /** Only these tools are offered to the agent. */
  allowTools?: string[];
  /** Per-tool read/write override. Anything not read-only needs the owner's confirmation. */
  toolOverrides?: Record<string, "read" | "write">;
  /** Lower the server's per-room limits (seconds). */
  maxDurationSeconds?: number;
  idleTimeoutSeconds?: number;
  fetch?: typeof fetch;
}

/** Tools the Housekeeper voice agent may use. Keep this list short. */
export const DEFAULT_ALLOWED_TOOLS = ["list_tasks", "add_task"];
/** `add_task` changes data: without `readOnlyHint` the agent asks the owner to confirm first. */
export const DEFAULT_TOOL_OVERRIDES: Record<string, "read" | "write"> = {
  list_tasks: "read",
  add_task: "write",
};

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

export function createVoiceRoutes(
  options: VoiceRoutesOptions,
): (req: Request) => Promise<Response> {
  const f = options.fetch ?? fetch;
  const base = `${options.openblahUrl.replace(/\/+$/, "")}/v1`;
  const call = (path: string, body: unknown) =>
    f(`${base}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.openblahApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

  return async (req) => {
    const { pathname } = new URL(req.url);
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const user = await options.authenticate(req);
    if (!user) return json(401, { error: "not logged in" });

    // Warm-up ping when the app opens or comes to the foreground. Never fails the app.
    if (pathname.endsWith("/voice/warmup")) {
      const res = await call("/warmup", { userId: user.id }).catch(() => null);
      return json(200, { status: res?.ok ? "ok" : "unavailable" });
    }

    // One call: room (agent on, single user "Direct" call) plus a token for this user.
    if (pathname.endsWith("/voice/session")) {
      const room = await call("/rooms", {
        hostUserId: user.id,
        hostDisplayName: user.displayName,
        agent: "on",
        // Housekeeper holds personal data: refuse free-tier keys. Remove if you only use product keys you trust.
        sensitive: true,
        maxDurationSeconds: options.maxDurationSeconds,
        idleTimeoutSeconds: options.idleTimeoutSeconds,
        mcp: {
          servers: [{ id: "housekeeper", url: options.mcpUrl }],
          // The logged-in user's token. It stays on the OpenBlah server and never reaches the app.
          userToken: user.mcpToken,
          allowTools: options.allowTools ?? DEFAULT_ALLOWED_TOOLS,
          toolOverrides: options.toolOverrides ?? DEFAULT_TOOL_OVERRIDES,
        },
      });
      if (!room.ok) return passThroughError(room);
      const { id: roomId } = (await room.json()) as { id: string };
      const token = await call("/tokens", {
        roomId,
        userId: user.id,
        displayName: user.displayName,
      });
      if (!token.ok) return passThroughError(token);
      const t = (await token.json()) as { token: string; expiresIn: number };
      // The app gets the room token only. Never forward the room object (it can hold config).
      return json(200, { roomId, token: t.token, expiresIn: t.expiresIn });
    }
    return json(404, { error: "not found" });
  };
}

/** Pass a cap or setup error on to the app in a form it can show, without leaking server detail. */
async function passThroughError(res: Response): Promise<Response> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  // 429 `host_cap` / `user_cap` means the monthly minute cap is reached: show "voice limit reached".
  const status = res.status === 429 || res.status === 403 ? res.status : 502;
  return json(status, { error: body.error ?? "voice unavailable", code: body.code });
}

/** Adapter for Node's http / Express: `app.use("/api", toNodeListener(createVoiceRoutes(...)))`. */
export function toNodeListener(
  handler: (req: Request) => Promise<Response>,
): (
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) => Promise<void> {
  return async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === "string") headers.set(k, v);
    }
    const url = `http://${req.headers.host ?? "localhost"}${(req as { originalUrl?: string }).originalUrl ?? req.url ?? "/"}`;
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const out = await handler(
      new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? Buffer.concat(chunks) : undefined,
      }),
    );
    res.writeHead(out.status, Object.fromEntries([...out.headers.entries()]));
    res.end(Buffer.from(await out.arrayBuffer()));
  };
}
