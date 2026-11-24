import { useEffect, useRef, useState } from "react";
import type { ParticipantInfo } from "./client.js";
import {
  useAgentControl,
  useAgentState,
  useAiPause,
  useConsent,
  useHostControls,
  useMute,
  useParticipants,
  useRole,
  useRoom,
  useToolApprovals,
} from "./react.js";

/**
 * Colours, sizes and shape of `<OpenBlahRoom />`. Every field is optional when you pass a theme:
 * missing fields fall back to {@link defaultTheme}. Colours are CSS colour strings on the web and
 * React Native colour values in the app; the same strings work in both.
 * @public
 */
export interface OpenBlahTheme {
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentText: string;
  danger: string;
  warning: string;
  border: string;
  /** Corner radius in pixels. */
  radius: number;
  /** Base spacing in pixels. */
  spacing: number;
  /** Base font size in pixels. */
  fontSize: number;
}

/** The built-in light theme. @public */
export const defaultTheme: OpenBlahTheme = {
  background: "#ffffff",
  surface: "#f4f4f5",
  text: "#18181b",
  mutedText: "#52525b",
  accent: "#2563eb",
  accentText: "#ffffff",
  danger: "#b91c1c",
  warning: "#fde68a",
  border: "#d4d4d8",
  radius: 8,
  spacing: 8,
  fontSize: 16,
};

/** Fill the gaps of a partial theme with {@link defaultTheme}. @public */
export function resolveTheme(theme?: Partial<OpenBlahTheme>): OpenBlahTheme {
  const out = { ...defaultTheme };
  for (const [k, v] of Object.entries(theme ?? {})) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Every piece of text in `<OpenBlahRoom />`, for translation or rewording. @public */
export interface OpenBlahLabels {
  join: string;
  joining: string;
  leave: string;
  mute: string;
  unmute: string;
  you: string;
  agent: string;
  speaking: string;
  muted: string;
  agentState: string;
  aiPaused: string;
  pauseAi: string;
  resumeAi: string;
  invite: string;
  inviteCopied: string;
  inviteRevoke: string;
  endRoom: string;
  remove: string;
  consentAccept: string;
  bringInAgent: string;
  askForAgent: string;
  sendAgentOut: string;
  approve: string;
  decline: string;
  waitingForConsent: string;
  confirmAction: string;
  confirmYes: string;
  confirmNo: string;
  requestsAgent: string;
  /** Shown when the product does not pay for voice and the user needs their own key. */
  keyRequired: string;
  keyRequiredTrialUsed: string;
  /** Button that opens the add-key sheet. */
  addKey: string;
  /** Mic button: idle (tap to start) and the live states, used as accessible labels. */
  micStart: string;
  micEnd: string;
  micConnecting: string;
  micListening: string;
  micThinking: string;
  micSpeaking: string;
  /** Shown under the mic button when voice could not start or the agent did not join. A tap retries. */
  micFailed: string;
}

/** The English labels. @public */
export const defaultLabels: OpenBlahLabels = {
  join: "Join",
  joining: "Joining…",
  leave: "Leave",
  mute: "Mute",
  unmute: "Unmute",
  you: "you",
  agent: "agent",
  speaking: "speaking",
  muted: "muted",
  agentState: "Agent",
  aiPaused: "AI paused: nobody is being listened to.",
  pauseAi: "Pause AI",
  resumeAi: "Resume AI",
  invite: "Invite",
  inviteCopied: "Link copied",
  inviteRevoke: "Revoke link",
  endRoom: "End room for everyone",
  remove: "Remove",
  consentAccept: "I agree",
  bringInAgent: "Bring in the agent",
  askForAgent: "Ask the host to bring in the agent",
  sendAgentOut: "Send the agent out",
  approve: "Approve",
  decline: "Decline",
  waitingForConsent: "Waiting for consent: nobody is being listened to. Missing:",
  confirmAction: "Confirm:",
  confirmYes: "Yes, do it",
  confirmNo: "Cancel",
  requestsAgent: "asks to bring the agent in.",
  keyRequired: "Add your own key to keep using voice.",
  keyRequiredTrialUsed: "The free allowance is used up. Add your own key to keep using voice.",
  addKey: "Add your key",
  micStart: "Start voice",
  micEnd: "End voice",
  micConnecting: "Starting voice…",
  micListening: "Listening. Tap to end",
  micThinking: "Thinking. Tap to end",
  micSpeaking: "Speaking. Tap to end",
  micFailed: "Voice could not start. Tap to try again.",
};

/** Fill the gaps of partial labels with {@link defaultLabels}. @public */
export function resolveLabels(labels?: Partial<OpenBlahLabels>): OpenBlahLabels {
  const out = { ...defaultLabels };
  for (const [k, v] of Object.entries(labels ?? {})) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Parts of `<OpenBlahRoom />` that can be switched off with `hide`. @public */
export type OpenBlahRoomPart =
  | "mute"
  | "participants"
  | "agentState"
  | "consent"
  | "invite"
  | "agentControl"
  | "approvals"
  | "pause"
  | "endRoom";

/**
 * Props shared by `<OpenBlahRoom />` in `@openblah/web` and `@openblah/react-native`.
 * @public
 */
export interface OpenBlahRoomBaseProps {
  /** LiveKit server URL (`wss://…`) from your backend. */
  serverUrl: string;
  /** Room token from `POST /v1/tokens`. Joins as soon as both are set, unless `autoJoin` is false. */
  token: string;
  /** Join on mount. Default true. When false, the component shows a Join button. */
  autoJoin?: boolean;
  /** Partial theme, merged over {@link defaultTheme}. */
  theme?: Partial<OpenBlahTheme>;
  /** Partial labels, merged over {@link defaultLabels}. */
  labels?: Partial<OpenBlahLabels>;
  /** Parts to leave out. To replace a part, hide it and render your own with the hooks. */
  hide?: OpenBlahRoomPart[];
  /** Called after the user left or the room ended. */
  onLeave?: () => void;
  /** Called when joining fails. */
  onError?: (error: Error) => void;
  /**
   * Set when the product does not pay for this user's voice (a `KeyRequiredError` from starting
   * the call, or `useKeyStatus` saying `needs_key`). The room then shows "Add your own key to
   * keep using voice" with a button, instead of an error.
   */
  keyRequired?: { reason?: "product_not_paying" | "trial_used" } | null;
  /** The user tapped "Add your key": open your add-key sheet (`<OpenBlahAddKeySheet />`). */
  onAddKey?: () => void;
}

/**
 * Everything `<OpenBlahRoom />` shows, from the public hooks. The web and React Native components
 * both render from this, and you can too if you want your own layout.
 * @public
 */
export function useRoomView(props: {
  serverUrl: string;
  token: string;
  autoJoin?: boolean | undefined;
  onLeave?: (() => void) | undefined;
  onError?: ((error: Error) => void) | undefined;
}) {
  const room = useRoom();
  const participants: ParticipantInfo[] = useParticipants();
  const agentState = useAgentState();
  const approvals = useToolApprovals();
  const role = useRole();
  const mute = useMute();
  const pause = useAiPause();
  const host = useHostControls();
  const consent = useConsent();
  const control = useAgentControl();
  const [joining, setJoining] = useState(false);

  const cb = useRef(props);
  cb.current = props;
  const connectRef = useRef(room.connect);
  connectRef.current = room.connect;

  const join = async () => {
    setJoining(true);
    try {
      await room.connect(props.serverUrl, props.token);
    } catch (e) {
      cb.current.onError?.(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setJoining(false);
    }
  };
  const joinRef = useRef(join);
  joinRef.current = join;

  const autoJoin = props.autoJoin ?? true;
  useEffect(() => {
    if (autoJoin && props.serverUrl && props.token) void joinRef.current();
  }, [autoJoin, props.serverUrl, props.token]);

  const wasConnected = useRef(false);
  useEffect(() => {
    if (room.status === "connected") wasConnected.current = true;
    else if (room.status === "disconnected" && wasConnected.current) {
      wasConnected.current = false;
      cb.current.onLeave?.();
    }
  }, [room.status]);

  return {
    status: room.status,
    error: room.error,
    joining: joining || room.status === "connecting",
    connected: room.status === "connected",
    join,
    leave: () => room.disconnect(),
    participants,
    agentState,
    approvals,
    role,
    mute,
    pause,
    host,
    consent,
    control,
  };
}
