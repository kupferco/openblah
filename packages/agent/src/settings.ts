import { llm } from "@livekit/agents";
import type { McpConnection } from "./mcp/client.js";

/**
 * Voice settings: "switch to Claude", "speak Portuguese", "call yourself Ana". The settings
 * live on the OpenBlah server, which exposes them as an MCP tool (read, propose, confirm).
 * Changing a setting follows the write-confirmation rule: the agent proposes, asks the person
 * out loud, and applies it only after they answered in a LATER turn, and only for the same
 * person who asked. The server checks the host, the key and a signed, expiring token as well.
 */
export interface SettingsToolsOptions {
  roomId: string;
  /** The server's settings MCP connection (token: the agent secret). */
  connection: Pick<McpConnection, "callTool">;
  /** Who spoke the turn now being handled (participant identity). */
  currentSpeaker(): string | undefined;
  /** Counts finished user turns, so a confirmation cannot be given in the same turn. */
  turn(): number;
}

interface PendingChange {
  token: string;
  turn: number;
  actor: string;
  question: string;
}

export const SETTINGS_INSTRUCTIONS =
  "You can read and change this call's settings (model, language, your name) with tools. " +
  "To change one, propose it, then ask the person the question you were given and wait for their answer. " +
  "Only after they say yes, in their next turn, confirm it. If they say no, drop it. Never say tool names.";

/** Tools for the agent. Results are short sentences the model can say. */
export function settingsTools(opts: SettingsToolsOptions) {
  let pending: PendingChange | null = null;

  const call = async (tool: string, args: Record<string, unknown>) => {
    const actorUserId = opts.currentSpeaker();
    if (!actorUserId) return { ok: false as const, text: "I could not tell who is asking." };
    try {
      const r = await opts.connection.callTool(tool, { roomId: opts.roomId, actorUserId, ...args });
      return { ok: !r.isError, text: r.text, actorUserId };
    } catch {
      return { ok: false as const, text: "I could not reach the settings just now." };
    }
  };

  return {
    get_settings: llm.tool({
      description:
        "Read which model, language and name this call uses. Use it when asked what the current " +
        "setting is. Never say or read out the tool name.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const r = await call("get_settings", {});
        if (!r.ok) return r.text;
        const d = JSON.parse(r.text) as {
          llm: { provider: string };
          language: string;
          agentName?: string;
        };
        return `The model is ${d.llm.provider}, the language is ${d.language === "auto" ? "automatic" : d.language}, and my name is ${d.agentName ?? "not set"}.`;
      },
    }),
    change_settings: llm.tool({
      description:
        "Call when someone asks to change the model (for example 'switch to Claude'), the spoken " +
        "language, or your name. This does not change anything yet: it returns a question to ask " +
        "the person. Ask it, then wait for their answer. Never say or read out the tool name.",
      parameters: {
        type: "object",
        properties: {
          llm: {
            type: "string",
            enum: ["gemini", "openai", "claude", "default"],
            description: "The model provider.",
          },
          model: { type: "string", description: "Optional exact model name." },
          language: { type: "string", enum: ["en", "pt", "auto"] },
          agentName: { type: "string", description: "The name the agent goes by." },
        },
      },
      execute: async (args) => {
        pending = null;
        const r = await call("propose_settings_change", args as Record<string, unknown>);
        if (!r.ok) return r.text;
        const d = JSON.parse(r.text) as { question: string; confirmationToken: string };
        pending = {
          token: d.confirmationToken,
          turn: opts.turn(),
          actor: r.actorUserId!,
          question: d.question,
        };
        return `Nothing has changed yet. Ask the person: "${d.question}" and wait for their answer.`;
      },
    }),
    confirm_settings_change: llm.tool({
      description:
        "Call only after the person has said yes to the question you asked about changing a " +
        "setting, in their reply. Never call it in the same turn as the request. Never say or " +
        "read out the tool name.",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        const p = pending;
        if (!p) return "There is nothing waiting to be confirmed.";
        if (opts.turn() <= p.turn) {
          return `Not yet. Ask the person: "${p.question}" and wait for their answer.`;
        }
        if (opts.currentSpeaker() !== p.actor) {
          return "Only the person who asked can confirm it. Ask them.";
        }
        pending = null;
        const r = await call("confirm_settings_change", { confirmationToken: p.token });
        if (!r.ok) return r.text;
        const d = JSON.parse(r.text) as { changed: string; note?: string };
        return `Done: I will ${d.changed}. ${d.note ?? ""}`.trim();
      },
    }),
  };
}

/** The room's language override from the job metadata (`{"language":"pt"}`), if the room set one. */
export function languageFromMetadata(metadata: string | undefined): "en" | "pt" | undefined {
  try {
    const l = (JSON.parse(metadata ?? "") as { language?: unknown } | null)?.language;
    return l === "en" || l === "pt" ? l : undefined;
  } catch {
    return undefined;
  }
}
