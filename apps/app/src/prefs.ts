import { config } from "./config.js";

/** Settings kept on the phone. Model, keys and language live on the server (`useOnboarding`). */
export interface Prefs {
  agentName: string;
}

export interface PrefsStore {
  load(): Promise<Prefs>;
  save(prefs: Prefs): Promise<void>;
}

export const defaultPrefs: Prefs = { agentName: config.defaultAgentName };
