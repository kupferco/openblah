import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  OpenBlahClient,
  type AgentState,
  type ClientSnapshot,
  type ParticipantInfo,
} from "./client.js";

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
