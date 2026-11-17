/**
 * Versioned consent text (plan section 7). Bump CONSENT_VERSION whenever the
 * wording changes: stored consent for an older version no longer counts.
 */
export const CONSENT_VERSION = "1";

export const DEFAULT_AGENT_NAME = "Blah";

/** Filled in T19 with the real list of third-party processors. */
export const PROCESSORS_PLACEHOLDER = "[processors list: filled in T19]";

const TEMPLATE_V1 =
  "An AI called {agentName} listens to this call and takes notes. " +
  "Audio is not saved. Transcript and summary are saved in the call history for everyone in the call. " +
  "Audio and text pass through these third-party processors: {processors}.";

export function renderConsentText(
  agentName: string = DEFAULT_AGENT_NAME,
  processors: string = PROCESSORS_PLACEHOLDER,
): string {
  return TEMPLATE_V1.replace("{agentName}", () => agentName).replace(
    "{processors}",
    () => processors,
  );
}
