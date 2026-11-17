import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  OpenBlahClient,
  type AgentState,
  type ClientSnapshot,
  type ParticipantInfo,
} from "./client.js";
import type { ConsentStatus, CreateInviteOptions, Invite, InvitePreview } from "./api.js";
import type { InviteRequestMessage, Role } from "./protocol.js";

const ClientContext = createContext<OpenBlahClient | null>(null);

/** Provides an {@link OpenBlahClient} to the hooks below. Creates one if `client` is omitted. */
export function OpenBlahProvider(props: { client?: OpenBlahClient; children?: ReactNode }) {
  const client = useMemo(() => props.client ?? new OpenBlahClient(), [props.client]);
  useEffect(() => () => void client.disconnect(), [client]);
  return createElement(ClientContext.Provider, { value: client }, props.children);
}

function useClient(): OpenBlahClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error("OpenBlah hooks must be used inside <OpenBlahProvider>");
  return c;
}

function useSnapshot(client: OpenBlahClient): ClientSnapshot {
  return useSyncExternalStore(
    (cb) => client.on("change", cb),
    () => client.getSnapshot(),
    () => client.getSnapshot(),
  );
}

/** Connection state plus `connect` / `disconnect`. */
export function useRoom() {
  const client = useClient();
  const s = useSnapshot(client);
  return {
    status: s.status,
    error: s.error,
    connect: (serverUrl: string, token: string) => client.connect(serverUrl, token),
    disconnect: () => client.disconnect(),
  };
}

/** Everyone in the room, including you and the agent. */
export function useParticipants(): ParticipantInfo[] {
  return useSnapshot(useClient()).participants;
}

/** The agent's state: listening, thinking, speaking, muted (you are muted) or unavailable (no agent in the room). */
export function useAgentState(): AgentState {
  return useSnapshot(useClient()).agentState;
}

/** Local microphone state and controls. */
export function useMute() {
  const client = useClient();
  const s = useSnapshot(client);
  return {
    muted: s.muted,
    setMuted: (m: boolean) => client.setMuted(m),
    toggle: () => client.toggleMute(),
  };
}

/** Your role in the room (`host`, `member` or `guest`), or null when not connected. */
export function useRole(): Role | null {
  return useSnapshot(useClient()).role;
}

/**
 * Pause the AI for everyone. `paused` is true while nobody is being listened to:
 * show it prominently (for example a banner "AI paused"), the agent says so too.
 */
export function useAiPause() {
  const client = useClient();
  const s = useSnapshot(client);
  return {
    paused: s.aiPaused,
    setPaused: (p: boolean) => client.setAiPaused(p),
    toggle: () => client.setAiPaused(!s.aiPaused),
  };
}

/**
 * Host controls: invite links, removing people and ending the room. Everything
 * is rejected by the server unless you are the host; `isHost` lets a UI hide the buttons.
 */
export function useHostControls() {
  const client = useClient();
  const role = useSnapshot(client).role;
  return {
    isHost: role === "host",
    createInvite: (options?: CreateInviteOptions): Promise<Invite> => client.createInvite(options),
    revokeInvite: (inviteId: string) => client.revokeInvite(inviteId),
    removeParticipant: (userId: string) => client.removeParticipant(userId),
    endRoom: () => client.endRoom(),
  };
}

/**
 * Consent for a room you are already in (an app user added after the call started).
 * `needed` is true while the server has no consent from you for the current text.
 */
export function useConsent() {
  const client = useClient();
  const { status, userId } = useSnapshot(client);
  const [state, setState] = useState<ConsentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connected = status === "connected";

  const refresh = useCallback(async () => {
    try {
      setState(await client.getConsent());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);

  useEffect(() => {
    if (connected) void refresh();
    else setState(null);
  }, [connected, refresh]);

  const accept = useCallback(async () => {
    if (!state) return;
    await client.giveConsent(state.version);
    await refresh();
  }, [client, state, refresh]);

  return {
    /** Consent wording to show, with `version`. Null until loaded. */
    text: state?.text ?? null,
    version: state?.version ?? null,
    agentName: state?.agentName ?? null,
    /** True when you have not accepted the current text yet. */
    needed: !!state && !!userId && state.missing.some((m) => m.userId === userId),
    error,
    accept,
    refresh,
  };
}

/**
 * The guest side of an invite link: loads the consent text for `token`, and
 * `join` connects with the consent the guest accepted.
 */
export function useInviteJoin(token: string | null) {
  const client = useClient();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!token) return;
    let live = true;
    client.getInvitePreview(token).then(
      (p) => live && setPreview(p),
      (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [client, token]);

  const join = useCallback(
    async (displayName: string, accepted: boolean) => {
      if (!token || !preview) throw new Error("Invite not loaded");
      if (!accepted && preview.agent !== "off") throw new Error("Consent is required");
      setJoining(true);
      setError(null);
      try {
        await client.joinWithInvite(
          token,
          displayName,
          accepted ? { accepted: true, textVersion: preview.consent.version } : null,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setJoining(false);
      }
    },
    [client, token, preview],
  );

  return { preview, error, joining, join };
}

/**
 * Host: be called when the agent was asked to invite someone ("Blah, invite my mother").
 * Pick the contact, then resolve with `"sent"` once you shared a link, or `"declined"`.
 * The response is sent to the agent for you.
 */
export function useInviteRequests(
  handler: (request: InviteRequestMessage) => Promise<"sent" | "declined">,
): void {
  const client = useClient();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(
    () =>
      client.on("inviteRequest", (req) => {
        ref.current(req).then(
          (status) => client.respondToInviteRequest(req.requestId, status),
          () => client.respondToInviteRequest(req.requestId, "declined"),
        );
      }),
    [client],
  );
}

export { useOnboarding, type UseOnboardingOptions } from "./onboarding.js";
