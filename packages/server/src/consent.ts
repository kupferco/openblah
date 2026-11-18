/**
 * Versioned consent text (plan section 7). Bump CONSENT_VERSION whenever the
 * wording changes: stored consent for an older version no longer counts.
 */
export const CONSENT_VERSION = "2";

export const DEFAULT_AGENT_NAME = "Blah";

/** The third-party processors for the default setup. Keep in step with the README "Privacy and data" table. */
export const DEFAULT_PROCESSORS =
  "LiveKit (call audio relay), Deepgram (speech to text), Google Gemini (language model), Cartesia (text to speech)";

/** Kept for older callers. */
export const PROCESSORS_PLACEHOLDER = DEFAULT_PROCESSORS;

const TEMPLATE_V1 =
  "An AI called {agentName} listens to this call and takes notes. " +
  "Audio is never saved. If the host turned on saving notes, the transcript, notes and summary are kept in the call history for everyone in the call and deleted after the host's retention period (30 days unless changed), or earlier if the host deletes them. " +
  "Audio and text pass through these third-party processors: {processors}.";

export function renderConsentText(
  agentName: string = DEFAULT_AGENT_NAME,
  processors: string = DEFAULT_PROCESSORS,
): string {
  return TEMPLATE_V1.replace("{agentName}", () => agentName).replace(
    "{processors}",
    () => processors,
  );
}
