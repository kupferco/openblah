import { llm } from "@livekit/agents";
import type { LlmProvider } from "../providers/types.js";
import type { McpCallResult, McpConnection, McpToolInfo } from "./client.js";
import type { ActionLog, McpRoomConfig } from "./types.js";

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
}

export interface ConnectedServer {
  id: string;
  ownerId: string;
  connection: McpConnection;
  tools: McpToolInfo[];
}

/** Read-only only when the server says so; unknown counts as "changes something" (T13 confirms). */
export function isReadOnly(tool: McpToolInfo): boolean {
  return tool.readOnlyHint === true;
}

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

export interface BuildToolsOptions {
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
  const { config, servers, provider, log, hooks } = opts;
  const now = opts.now ?? (() => new Date());
  const allow = config.allowTools ? new Set(config.allowTools) : undefined;
  const tools: Record<string, llm.FunctionTool> = {};
  const count = new Map<string, number>();
  for (const s of servers) for (const t of s.tools) count.set(t.name, (count.get(t.name) ?? 0) + 1);

  for (const server of servers) {
    for (const tool of server.tools) {
      if (allow && !allow.has(tool.name)) continue;
      const exposed = (count.get(tool.name) ?? 0) > 1 ? `${server.id}_${tool.name}` : tool.name;
      const readOnly = isReadOnly(tool);
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
          const record = (status: "ok" | "error" | "blocked" | "denied", detail?: string) =>
            log.record({ ...entry, at: now().toISOString(), status, detail });
          // Only the owner of the connection can make the agent use its credentials.
          if (askedBy !== server.ownerId) {
            await record("denied", "asker does not own this connection");
            return "I can only do that for the person whose account it is.";
          }
          if (!readOnly) {
            await record("blocked", "tool changes something; confirmation comes later (T13)");
            return "I am not able to do that yet.";
          }
          let timer: ReturnType<typeof setTimeout> | undefined;
          timer = setTimeout(() => {
            timer = undefined;
            hooks.sayHold();
            hooks.setWorking(true, label(tool.name));
          }, opts.slowMs ?? SLOW_TOOL_MS);
          let result: McpCallResult;
          try {
            result = await server.connection.callTool(tool.name, args);
          } catch (err) {
            await record("error", err instanceof Error ? err.message.slice(0, 200) : "call failed");
            return "That did not work. Tell the person you could not get it.";
          } finally {
            if (timer) clearTimeout(timer);
            else hooks.setWorking(false);
          }
          if (result.isError) {
            await record("error", result.text.slice(0, 200));
            return "That did not work. Tell the person you could not get it.";
          }
          const { spoken, long } = summariseForSpeech(result.text);
          if (long) hooks.showNote({ title: label(tool.name), text: result.text });
          await record("ok", long ? "long result sent to screen" : spoken);
          return spoken;
        },
      }) as unknown as llm.FunctionTool;
    }
  }
  return tools;
}

/** One line for the system prompt so the agent never names tools aloud. */
export const MCP_INSTRUCTIONS =
  "You can look things up with tools. Never say tool names or mention that you are calling a tool. " +
  "Say the answer in one or two short sentences; if a result is long it is shown on the screen, so point to it.";
