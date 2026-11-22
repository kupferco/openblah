import { Hono, type Context } from "hono";

/** What the settings tools do. The app implements it with its storage and rules. */
export interface SettingsToolOps {
  get(args: { roomId: string; actorUserId: string }): Promise<ToolOutcome>;
  propose(args: {
    roomId: string;
    actorUserId: string;
    change: Record<string, unknown>;
  }): Promise<ToolOutcome>;
  confirm(args: {
    roomId: string;
    actorUserId: string;
    confirmationToken: string;
  }): Promise<ToolOutcome>;
}

export interface ToolOutcome {
  text: string;
  isError?: boolean;
}

const idArgs = {
  roomId: { type: "string", description: "The room's id." },
  actorUserId: {
    type: "string",
    description: "The person who asked (their user id). Only the room's host may change settings.",
  },
};

const changeProps = {
  llm: {
    type: "string",
    enum: ["gemini", "openai", "claude", "default"],
    description: "Which model should power the agent. 'default' goes back to the default.",
  },
  model: { type: "string", description: "Optional exact model name for that provider." },
  language: {
    type: "string",
    enum: ["en", "pt", "auto"],
    description: "Spoken language: en, pt, or auto to follow what people speak.",
  },
  agentName: { type: "string", description: "The name the agent goes by in this room." },
  whoPays: {
    type: "string",
    enum: ["product", "user_key", "product_trial"],
    description:
      "Product owner only: who pays for voice. product = the product's key, user_key = each " +
      "user's own key, product_trial = the product's key up to a trial allowance.",
  },
  userMonthlyMinutes: {
    type: ["number", "string"],
    description:
      "Product owner only: monthly agent minutes per user. 0 turns the cap off; " +
      "'default' goes back to the default (60 when the product pays).",
  },
};

export const SETTINGS_TOOLS = [
  {
    name: "get_settings",
    description:
      "Read the room's model, language override and agent name. For the product owner it also returns who pays, the per-user cap and counts (users with their own key, users asked for a key, minutes on the product key).",
    inputSchema: { type: "object", properties: idArgs, required: ["roomId", "actorUserId"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "propose_settings_change",
    description:
      "Ask to change the room's model, language or agent name. This changes nothing yet: it " +
      "returns a confirmation token and the sentence to ask the person. Ask them out loud, and " +
      "only after they say yes call confirm_settings_change with the token.",
    inputSchema: {
      type: "object",
      properties: { ...idArgs, ...changeProps },
      required: ["roomId", "actorUserId"],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "confirm_settings_change",
    description:
      "Apply a change proposed by propose_settings_change, after the person said yes to it.",
    inputSchema: {
      type: "object",
      properties: { ...idArgs, confirmationToken: { type: "string" } },
      required: ["roomId", "actorUserId", "confirmationToken"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown };

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

async function callTool(ops: SettingsToolOps, name: string, args: Record<string, unknown>) {
  const roomId = str(args.roomId);
  const actorUserId = str(args.actorUserId);
  if (!roomId || !actorUserId)
    return { text: "roomId and actorUserId are required", isError: true };
  switch (name) {
    case "get_settings":
      return ops.get({ roomId, actorUserId });
    case "propose_settings_change": {
      const change = { ...args };
      delete change.roomId;
      delete change.actorUserId;
      return ops.propose({ roomId, actorUserId, change });
    }
    case "confirm_settings_change": {
      const confirmationToken = str(args.confirmationToken);
      if (!confirmationToken) return { text: "confirmationToken is required", isError: true };
      return ops.confirm({ roomId, actorUserId, confirmationToken });
    }
    default:
      return null;
  }
}

/**
 * The settings MCP server: stateless Streamable HTTP, JSON replies. Mount it behind auth; it
 * trusts the caller (the host app's backend or the agent worker) to name the acting user,
 * like the REST host controls do.
 */
export function settingsMcpApp(opsFor: SettingsToolOps | ((c: Context) => SettingsToolOps)): Hono {
  const app = new Hono();
  app.get("/", (c) => c.json({ error: "use POST" }, 405));
  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } },
        400,
      );
    }
    const ops = typeof opsFor === "function" ? opsFor(c) : opsFor;
    const handle = async (m: Rpc) => {
      if (m.id === undefined || m.id === null) return null; // notification
      const reply = (result: unknown) => ({ jsonrpc: "2.0", id: m.id, result });
      const fail = (code: number, message: string) => ({
        jsonrpc: "2.0",
        id: m.id,
        error: { code, message },
      });
      const params = (m.params ?? {}) as Record<string, unknown>;
      switch (m.method) {
        case "initialize":
          return reply({
            protocolVersion: str(params.protocolVersion) ?? "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "openblah-settings", version: "1.0.0" },
          });
        case "ping":
          return reply({});
        case "tools/list":
          return reply({ tools: SETTINGS_TOOLS });
        case "tools/call": {
          const args = (params.arguments ?? {}) as Record<string, unknown>;
          const out = await callTool(ops, String(params.name), args);
          if (!out) return fail(-32602, "unknown tool");
          return reply({
            content: [{ type: "text", text: out.text }],
            ...(out.isError ? { isError: true } : {}),
          });
        }
        default:
          return fail(-32601, "method not found");
      }
    };
    const msgs = Array.isArray(body) ? (body as Rpc[]) : [body as Rpc];
    const out = (await Promise.all(msgs.map(handle))).filter((x) => x !== null);
    if (out.length === 0) return c.body(null, 202);
    return c.json(Array.isArray(body) ? out : out[0]);
  });
  return app;
}
