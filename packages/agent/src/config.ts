export interface AgentConfig {
  /** Name the agent uses for itself (configurable per room later, T9). */
  agentName: string;
  /** Name registered with LiveKit for explicit dispatch. */
  dispatchName: string;
}

/** LiveKit dispatch name the server uses in `POST /v1/rooms/:id/agent`. */
export const DEFAULT_DISPATCH_NAME = "openblah-agent";
export const DEFAULT_AGENT_NAME = "Blah";

type Env = Record<string, string | undefined>;

export function configFromEnv(env: Env = process.env): AgentConfig {
  return {
    agentName: env.OPENBLAH_AGENT_NAME?.trim() || DEFAULT_AGENT_NAME,
    dispatchName: env.OPENBLAH_AGENT_DISPATCH_NAME?.trim() || DEFAULT_DISPATCH_NAME,
  };
}

/** System prompt for Direct mode: short spoken replies in the speaker's language. */
export function directInstructions(cfg: Pick<AgentConfig, "agentName">): string {
  return [
    `You are ${cfg.agentName}, a voice assistant in a live call with one person.`,
    "Your replies are spoken aloud, so keep them short: one to three sentences unless the person asks for more.",
    "Use plain spoken language. No markdown, lists, emoji or URLs read out letter by letter.",
    "Always reply in the language the person just spoke. You speak English and Portuguese (Brazilian).",
    "If you did not catch something or it is unclear, ask a short question.",
  ].join(" ");
}
