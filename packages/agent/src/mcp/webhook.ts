import { createHmac } from "node:crypto";
import type { McpCallResult, McpConnection, McpToolInfo } from "./client.js";
import type { WebhookToolConfig } from "./types.js";

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;
export const SIGNATURE_HEADER = "X-OpenBlah-Signature";
export const TIMESTAMP_HEADER = "X-OpenBlah-Timestamp";

/** HMAC-SHA256 over `${timestamp}.${body}`, hex, prefixed `sha256=`. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Plain http is only allowed for loopback (local development and tests). */
export function isAllowedWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Tool description in the same shape MCP tools have. Webhook tools count as "write" unless `readOnly`. */
export function webhookToolInfo(t: WebhookToolConfig): McpToolInfo {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema ?? { type: "object", properties: {} },
    readOnlyHint: t.readOnly === true,
  };
}

/**
 * A "connection" that calls one webhook tool. The request is signed so the
 * receiver can check it came from OpenBlah; it times out and never follows
 * redirects. The secret is never put in a result or error.
 */
export function webhookConnection(
  tool: WebhookToolConfig,
  ctx: { roomId: string },
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): McpConnection {
  return {
    listTools: async () => [webhookToolInfo(tool)],
    close: async () => {},
    async callTool(name, args, meta): Promise<McpCallResult> {
      const body = JSON.stringify({
        tool: name,
        arguments: args,
        roomId: ctx.roomId,
        ...(meta?.approvalId ? { approvalId: meta.approvalId } : {}),
      });
      const timestamp = String(Math.floor(now().getTime() / 1000));
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        tool.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS,
      );
      try {
        const res = await fetchImpl(tool.url, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            [TIMESTAMP_HEADER]: timestamp,
            [SIGNATURE_HEADER]: signWebhook(tool.secret, timestamp, body),
          },
          body,
        });
        const raw = (await res.text()).slice(0, 10_000);
        let text = raw;
        try {
          const j = JSON.parse(raw) as { text?: unknown; result?: unknown };
          if (typeof j.text === "string") text = j.text;
          else if (j.result !== undefined) text = JSON.stringify(j.result);
        } catch {
          // Plain text reply.
        }
        return { isError: !res.ok, text: res.ok ? text : `webhook returned ${res.status}` };
      } catch (err) {
        if (controller.signal.aborted) throw new Error("webhook timed out");
        throw new Error(err instanceof Error ? err.message : "webhook failed");
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
