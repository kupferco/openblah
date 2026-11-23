import { useRef, type ReactNode } from "react";
import { useAgentState, useClientHandle, useRoom, useToolApprovals } from "./react.js";
import type { AgentState } from "./client.js";
import type { OpenBlahLabels, OpenBlahTheme } from "./room-view.js";

/** What the mic button shows. `idle` is a plain mic; the other four are the live states. @public */
export type MicButtonState = "idle" | "connecting" | "listening" | "thinking" | "speaking";

/** Room credentials from your backend (`POST /v1/tokens`). @public */
export interface MicSession {
  serverUrl: string;
  token: string;
}

/** Options of {@link useMicButton} and the `<OpenBlahMicButton />` components. @public */
export interface UseMicButtonOptions {
  /** Called on a tap when no session is running. Fetch a fresh room token from your backend. */
  start: () => Promise<MicSession>;
  /** Called when starting fails (including a `KeyRequiredError`). */
  onError?: (error: Error) => void;
  /** Called after the user ended the session with a tap. */
  onEnd?: () => void;
}

/**
 * State and the tap handler behind the mic button, for building your own. The session lives on
 * the client in `<OpenBlahProvider>`, so it survives navigation and every instance shows the same state.
 * @public
 */
export function useMicButton(options: UseMicButtonOptions) {
  const room = useRoom();
  const agent: AgentState = useAgentState();
  const approvals = useToolApprovals();
  const opts = useRef(options);
  opts.current = options;
  const client = useClientHandle();

  const active = room.status === "connected";
  const connecting = room.status === "connecting";
  const state: MicButtonState = connecting
    ? "connecting"
    : !active
      ? "idle"
      : agent === "thinking"
        ? "thinking"
        : agent === "speaking"
          ? "speaking"
          : "listening";

  const toggle = async () => {
    if (active) {
      await room.disconnect();
      opts.current.onEnd?.();
      return;
    }
    try {
      await client.startOnce(() => opts.current.start());
    } catch (e) {
      opts.current.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  };

  return {
    state,
    /** True while a session runs or is starting: a tap now ends it (or is ignored while starting). */
    active: active || connecting,
    error: room.error,
    toggle,
    approvals,
  };
}

/** Pending write action the agent wants confirmed, as passed to `renderConfirmation`. @public */
export interface MicConfirmation {
  id: string;
  summary: string;
  approve: () => void;
  decline: () => void;
}

/** Props shared by `<OpenBlahMicButton />` in `@openblah/web` and `@openblah/react-native`. @public */
export interface OpenBlahMicButtonBaseProps extends UseMicButtonOptions {
  /** Partial theme: `accent` and `accentText` colour the button, `danger` the live outline, `radius` is ignored (it is round). */
  theme?: Partial<OpenBlahTheme>;
  /** Partial labels (`micStart`, `micEnd`, `micConnecting`, `micListening`, `micThinking`, `micSpeaking`, `confirmYes`, `confirmNo`). */
  labels?: Partial<OpenBlahLabels>;
  /** Button diameter in pixels. Default 56. */
  size?: number;
  /** Halo colours per live state. Defaults: listening = accent, thinking = warning, speaking = success green. */
  haloColors?: Partial<Record<"listening" | "thinking" | "speaking", string>>;
  /** Hide the built-in compact confirmation card (answer approvals yourself with `useToolApprovals`). Default false. */
  hideConfirmation?: boolean;
  /** Replace the compact confirmation card with your own. */
  renderConfirmation?: (a: MicConfirmation) => ReactNode;
}

/** Default halo colours. @public */
export function micHaloColor(
  state: MicButtonState,
  t: OpenBlahTheme,
  override?: OpenBlahMicButtonBaseProps["haloColors"],
): string | null {
  if (state === "idle") return null;
  if (state === "connecting") return t.mutedText;
  const own = override?.[state];
  if (own) return own;
  return state === "listening" ? t.accent : state === "thinking" ? "#f59e0b" : "#16a34a";
}

/** The accessible label for a mic button state. @public */
export function micLabel(state: MicButtonState, l: OpenBlahLabels): string {
  switch (state) {
    case "idle":
      return l.micStart;
    case "connecting":
      return l.micConnecting;
    case "listening":
      return l.micListening;
    case "thinking":
      return l.micThinking;
    case "speaking":
      return l.micSpeaking;
  }
}
