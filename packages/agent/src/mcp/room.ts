import type { llm } from "@livekit/agents";
import { connectMcp, type McpConnection } from "./client.js";
import { webhookConnection, webhookToolInfo } from "./webhook.js";
import { APPROVAL_DECISION_TOPIC, APPROVAL_RESPONSE_TOPIC } from "./approvals.js";
import { buildMcpToolset, type ConnectedServer, type McpVoiceHooks } from "./tools.js";
import type { ActionLog, McpRoomConfig } from "./types.js";
import type { LlmProvider } from "../providers/types.js";

export interface McpRoom {
  tools: llm.ToolContextLike;
  /**
   * Feed a LiveKit data message in. Tapped confirmations arrive on
   * `openblah.approval.response` from the tapping participant, forwarded
   * server decisions on `openblah.approval.decision` with no sender
   * participant (the server). Anything else is ignored.
   */
  handleData(msg: { topic?: string; payload: string; sender?: string }): Promise<void>;
  close(): Promise<void>;
}

/** Connect the room's servers (one failing server does not stop the others) and build tools. */
export async function openMcpRoom(opts: {
  roomId: string;
  config: McpRoomConfig;
  provider: Pick<LlmProvider, "formatToolSchema">;
  log: ActionLog;
  hooks: McpVoiceHooks;
  connect?: (url: string, token?: string) => Promise<McpConnection>;
  fetch?: typeof fetch;
}): Promise<McpRoom> {
  const connect = opts.connect ?? connectMcp;
  const servers: ConnectedServer[] = [];
  for (const s of opts.config.servers) {
    try {
      const connection = await connect(s.url, s.userToken ?? opts.config.userToken);
      servers.push({
        id: s.id,
        ownerId: s.ownerId ?? opts.config.ownerId ?? "",
        connection,
        tools: await connection.listTools(),
      });
    } catch {
      // Never log the URL query or token; the server is simply unavailable.
      console.error(
        JSON.stringify({ event: "mcp_connect_failed", roomId: opts.roomId, server: s.id }),
      );
    }
  }
  for (const t of opts.config.webhookTools ?? []) {
    servers.push({
      id: `webhook_${t.name}`,
      ownerId: t.ownerId ?? opts.config.ownerId ?? "",
      connection: webhookConnection(t, { roomId: opts.roomId }, opts.fetch),
      tools: [webhookToolInfo(t)],
    });
  }
  const { tools, approvals } = buildMcpToolset({ ...opts, servers });
  return {
    tools: tools as unknown as llm.ToolContextLike,
    async handleData({ topic, payload, sender }) {
      let msg: { approvalId?: unknown; approve?: unknown; actorUserId?: unknown };
      try {
        msg = JSON.parse(payload);
      } catch {
        return;
      }
      if (typeof msg.approvalId !== "string" || typeof msg.approve !== "boolean") return;
      let actor: string | undefined;
      if (topic === APPROVAL_RESPONSE_TOPIC) actor = sender;
      else if (topic === APPROVAL_DECISION_TOPIC && sender === undefined) {
        actor = typeof msg.actorUserId === "string" ? msg.actorUserId : undefined;
      }
      if (!actor) return;
      const out = await approvals.decide({
        approvalId: msg.approvalId,
        actor,
        approve: msg.approve,
        via: "tap",
      });
      if (out.status === "executed" || out.status === "declined" || out.status === "expired") {
        opts.hooks.announce(out.text);
      }
    },
    close: async () => {
      await Promise.allSettled(servers.map((s) => s.connection.close()));
    },
  };
}
