import { llm } from "@livekit/agents";
import type { LlmProvider } from "../providers/types.js";
import type { McpCallResult, McpConnection, McpToolInfo } from "./client.js";
import { ToolApprovals, type PendingApproval } from "./approvals.js";
import type { ActionLog, ActionStatus, ConfirmationEvidence, McpRoomConfig } from "./types.js";

/** Results longer than this are not read out; they go to the screen/notes channel. */
export const SPOKEN_RESULT_MAX_CHARS = 280;
/** A tool slower than this gets a short spoken hold and a visible "working" state. */
export const SLOW_TOOL_MS = 1500;

/** What the voice layer needs from the room. */
export interface McpVoiceHooks {
  /** Who spoke the turn that triggered the call (participant identity). */
  currentSpeaker(): string | undefined;
  /** Short spoken hold line ("One moment."). Never names a tool. */
  sayHold(): void;
  /** Visible working state on/off. */
  setWorking(working: boolean, label?: string): void;
  /** Full result for the screen/notes channel. */
  showNote(note: { title: string; text: string }): void;
  /** Number of user speech turns so far; a spoken confirmation must come after the read-back. */
  userTurnCount(): number;
  /** Show the tap-to-confirm card for a pending write action. */
  showApproval(req: {
    id: string;
    tool: string;
    summary: string;
    ownerId: string;
    expiresAt: string;
  }): void;
  /** The pending action ended: executed, declined or expired. */
  resolveApproval(id: string, status: "executed" | "declined" | "expired"): void;
  /** Say something unprompted (the result of a tapped confirmation). */
  announce(text: string): void;
}

export interface ConnectedServer {
  id: string;
  ownerId: string;
  connection: McpConnection;
  tools: McpToolInfo[];
}

/**
 * Read-only only when the host says so (override) or the server's
 * `readOnlyHint` does; unknown counts as "changes something" and needs
 * confirmation.
 */
export function isReadOnly(tool: McpToolInfo, override?: "read" | "write"): boolean {
  if (override) return override === "read";
  return tool.readOnlyHint === true;
}

/** One line of what a write will do, shown and read back. Values are cut short. */
export function describeAction(name: string, args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const text = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}: ${String(text).slice(0, 80)}`;
  });
  return parts.length ? `${label(name)} (${parts.join(", ")})` : label(name);
}

export const CONFIRM_TOOL_NAME = "confirm_pending_action";

/** Make a result short enough to speak; long text goes to the screen instead. */
export function summariseForSpeech(text: string): { spoken: string; long: boolean } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= SPOKEN_RESULT_MAX_CHARS) return { spoken: clean, long: false };
  return {
    spoken:
      "The result is long, so it is on the screen. Summarise the key point in one or two sentences and do not read it out.",
    long: true,
  };
}

/** Humanise a tool name for the "working" label (never spoken). */
function label(name: string): string {
  return name.replace(/[_-]+/g, " ");
}

export interface McpTools {
  tools: Record<string, llm.FunctionTool>;
  approvals: ToolApprovals;
}

export interface BuildToolsOptions {
  approvals?: ToolApprovals;
  roomId: string;
  config: McpRoomConfig;
  servers: ConnectedServer[];
  provider: Pick<LlmProvider, "formatToolSchema">;
  log: ActionLog;
  hooks: McpVoiceHooks;
  now?: () => Date;
  slowMs?: number;
}

/** Build LiveKit function tools from the connected servers' tools. */
export function buildMcpTools(opts: BuildToolsOptions): Record<string, llm.FunctionTool> {
  return buildMcpToolset(opts).tools;
}

/** Like {@link buildMcpTools} but also returns the pending-approval store. */
export function buildMcpToolset(opts: BuildToolsOptions): McpTools {
  const { config, servers, provider, log, hooks } = opts;
  const approvals =
    opts.approvals ??
    new ToolApprovals({ onResolved: (id, status) => hooks.resolveApproval(id, status) });
  let anyWrite = false;
  const now = opts.now ?? (() => new Date());
  const allow = config.allowTools ? new Set(config.allowTools) : undefined;
  const tools: Record<string, llm.FunctionTool> = {};
  const count = new Map<string, number>();
  for (const s of servers) for (const t of s.tools) count.set(t.name, (count.get(t.name) ?? 0) + 1);

  for (const server of servers) {
    for (const tool of server.tools) {
      if (allow && !allow.has(tool.name)) continue;
      const exposed = (count.get(tool.name) ?? 0) > 1 ? `${server.id}_${tool.name}` : tool.name;
      const readOnly = isReadOnly(tool, config.toolOverrides?.[tool.name]);
      if (!readOnly) anyWrite = true;
      tools[exposed] = llm.tool({
        name: exposed,
        description: tool.description,
        parameters: (provider.formatToolSchema?.(tool.inputSchema) ?? tool.inputSchema) as never,
        execute: async (args: Record<string, unknown>) => {
          const askedBy = hooks.currentSpeaker() ?? "unknown";
          const entry = {
            roomId: opts.roomId,
            askedBy,
            ownerId: server.ownerId,
            serverId: server.id,
            tool: tool.name,
            arguments: args,
          };
          const record = (
            status: ActionStatus,
            detail?: string,
            confirmation?: ConfirmationEvidence,
          ) =>
            log.record({
              ...entry,
              at: now().toISOString(),
              status,
              ...(confirmation ? { confirmation } : {}),
              detail,
            });
          // Only the owner of the connection can make the agent use its credentials.
          if (askedBy !== server.ownerId) {
            await record("denied", "asker does not own this connection");
            return "I can only do that for the person whose account it is.";
          }
          const run = async (
            approvalId?: string,
            evidence?: { via: "voice" | "tap"; by: string; summary: string },
          ): Promise<string> => {
            const confirmation =
              evidence && approvalId
                ? { ...evidence, at: now().toISOString(), approvalId }
                : undefined;
            let timer: ReturnType<typeof setTimeout> | undefined;
            timer = setTimeout(() => {
              timer = undefined;
              hooks.sayHold();
              hooks.setWorking(true, label(tool.name));
            }, opts.slowMs ?? SLOW_TOOL_MS);
            let result: McpCallResult;
            try {
              result = await server.connection.callTool(tool.name, args, { approvalId });
            } catch (err) {
              await record(
                "error",
                err instanceof Error ? err.message.slice(0, 200) : "call failed",
                confirmation,
              );
              return "That did not work. Tell the person you could not get it.";
            } finally {
              if (timer) clearTimeout(timer);
              else hooks.setWorking(false);
            }
            if (result.isError) {
              await record("error", result.text.slice(0, 200), confirmation);
              return "That did not work. Tell the person you could not get it.";
            }
            const { spoken, long } = summariseForSpeech(result.text);
            if (long) hooks.showNote({ title: label(tool.name), text: result.text });
            await record("ok", long ? "long result sent to screen" : spoken, confirmation);
            return spoken;
          };
          if (readOnly) return run();

          // A write: read it back and wait for the owner. Nothing runs yet.
          const summary = describeAction(tool.name, args);
          const pending: PendingApproval = approvals.create({
            ownerId: server.ownerId,
            summary,
            tool: tool.name,
            turnsAtCreation: hooks.userTurnCount(),
            execute: (who) => run(pendingId(), { ...who, summary }),
            reject: async (status, actor, reason) => {
              await record(status, `${reason} (by ${actor})`);
            },
          });
          const pendingId = () => pending.id;
          await record("pending", `waiting for confirmation: ${summary}`);
          hooks.showApproval({
            id: pending.id,
            tool: label(tool.name),
            summary,
            ownerId: server.ownerId,
            expiresAt: new Date(pending.expiresAt).toISOString(),
          });
          return (
            `Not done yet. It needs the person's OK first. Read back what you are about to do in one short sentence, using these details: ${summary}. ` +
            `Then ask "OK?" and wait for their answer. Do not say it is done.`
          );
        },
      }) as unknown as llm.FunctionTool;
    }
  }
  if (anyWrite) {
    tools[CONFIRM_TOOL_NAME] = llm.tool({
      name: CONFIRM_TOOL_NAME,
      description:
        "Call this only after the person has answered your read-back of a pending action out loud. " +
        "approve=true if they said yes, approve=false if they said no or to cancel. Never call it on your own.",
      parameters: (provider.formatToolSchema?.({
        type: "object",
        properties: { approve: { type: "boolean" } },
        required: ["approve"],
      }) ?? {
        type: "object",
        properties: { approve: { type: "boolean" } },
        required: ["approve"],
      }) as never,
      execute: async (args: Record<string, unknown>) => {
        const speaker = hooks.currentSpeaker() ?? "unknown";
        const target = approvals.latestFor(speaker);
        // A confirmation by someone without a pending action of their own is checked against the newest one.
        const id = target?.id ?? approvals.latestAny()?.id;
        if (!id) return "There is nothing waiting for confirmation.";
        const out = await approvals.decide({
          approvalId: id,
          actor: speaker,
          approve: args.approve === true,
          via: "voice",
          userTurns: hooks.userTurnCount(),
        });
        return out.text;
      },
    }) as unknown as llm.FunctionTool;
  }
  return { tools, approvals };
}

/** One line for the system prompt so the agent never names tools aloud. */
export const MCP_INSTRUCTIONS =
  "You can look things up and do things with tools. Never say tool names or mention that you are calling a tool. " +
  "When a tool says it needs the person's OK, read back what you will do and ask; call the confirmation tool only after they answer out loud. " +
  "Say the answer in one or two short sentences; if a result is long it is shown on the screen, so point to it.";
