import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  useAgentState,
  useInviteJoin,
  useMute,
  useParticipants,
  useRoom,
} from "@openblah/web/react";
import { classifyError, type BrowserSupport, type MicState } from "./lib.js";
import type { MicCheck } from "./mic.js";
import { holdWakeLock, inAppBrowserName, isMobileUserAgent, unlockAudio } from "./mobile.js";

export interface AppProps {
  token: string | null;
  support: BrowserSupport;
  startMic: (onState: (s: MicState) => void, onLevel: (l: number) => void) => Promise<MicCheck>;
  /** Resolves true when the call-history API (T19) is available for this invite. */
  checkHistory: (token: string) => Promise<boolean>;
  historyUrl: (token: string) => string;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <h1>OpenBlah</h1>
      {children}
    </main>
  );
}

function Notice({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Shell>
      <div role="alert" className="notice">
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
    </Shell>
  );
}

const AGENT_LABEL: Record<string, string> = {
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  muted: "muted",
  paused: "paused",
  unavailable: "not in this call",
};

export function App(props: AppProps) {
  const { token, support } = props;
  const invite = useInviteJoin(support.ok ? token : null);
  const room = useRoom();
  const participants = useParticipants();
  const agent = useAgentState();
  const { muted, toggle } = useMute();

  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [mic, setMic] = useState<MicState>("idle");
  const [level, setLevel] = useState(0);
  const micRef = useRef<MicCheck | null>(null);
  const [wasConnected, setWasConnected] = useState(false);
  const [left, setLeft] = useState(false);
  const [history, setHistory] = useState(false);

  const connected = room.status === "connected" || room.status === "reconnecting";
  const mobile = isMobileUserAgent(navigator.userAgent);
  // Keep the screen on during the call to reduce drops when the phone would sleep.
  useEffect(() => {
    if (!connected) return;
    const lock = holdWakeLock();
    return () => lock.release();
  }, [connected]);
  useEffect(() => {
    if (connected) setWasConnected(true);
  }, [connected]);
  const ended = wasConnected && !connected;

  useEffect(() => () => micRef.current?.stop(), []);
  // The preview step opened its own mic stream; free it once the call has its own.
  useEffect(() => {
    if (connected) {
      micRef.current?.stop();
      micRef.current = null;
    }
  }, [connected]);

  useEffect(() => {
    if (!ended || !token) return;
    let live = true;
    void props.checkHistory(token).then((ok) => live && setHistory(ok));
    return () => {
      live = false;
    };
  }, [ended, token, props]);

  if (!support.ok) {
    const inApp = inAppBrowserName(navigator.userAgent);
    return (
      <Notice title="This browser can't join">
        {support.reason}{" "}
        {inApp
          ? "This looks like an in-app browser. Open the link in Safari or Chrome instead (use the share or “open in browser” menu)."
          : mobile
            ? "Try Safari on iPhone or Chrome on Android, updated to the latest version."
            : "Try the latest Chrome, Safari or Firefox."}
      </Notice>
    );
  }
  if (!token) {
    return (
      <Notice title="No invite link">
        Open the link you were sent, it looks like openblah.web.app/j/…
      </Notice>
    );
  }

  if (ended) {
    return (
      <Shell>
        <div className="notice">
          <h2>{left ? "You left the call" : "The call has ended"}</h2>
          {history && (
            <p>
              <a href={props.historyUrl(token)}>View call history</a>
            </p>
          )}
        </div>
      </Shell>
    );
  }

  if (connected) {
    return (
      <Shell>
        {mobile && (
          <p className="banner" role="note">
            Keep this tab open and the screen on. If you switch apps or lock your phone, the call
            may drop.
          </p>
        )}
        <p className="status">
          {room.status === "reconnecting" ? "Reconnecting…" : "You are in the call"}
          {" · "}Agent: <span data-testid="agent-state">{AGENT_LABEL[agent] ?? agent}</span>
        </p>
        <ul aria-label="Participants">
          {participants.map((p) => (
            <li key={p.identity}>
              {p.name}
              {p.isLocal ? " (you)" : ""}
              {p.isAgent ? " (AI)" : ""}
              {p.isMuted ? " · muted" : ""}
              {p.isSpeaking ? " · speaking" : ""}
            </li>
          ))}
        </ul>
        <div className="row">
          <button onClick={() => void toggle()}>{muted ? "Unmute" : "Mute"}</button>
          <button
            className="danger"
            onClick={() => {
              setLeft(true);
              void room.disconnect();
            }}
          >
            Leave
          </button>
        </div>
      </Shell>
    );
  }

  if (invite.error && !invite.preview) {
    const kind = classifyError(invite.error);
    if (kind === "network")
      return (
        <Notice title="Can't reach the call server">
          Check your connection and reload the page.
        </Notice>
      );
    return (
      <Notice title="This link doesn't work">
        The invite has expired, been revoked, or the call has ended. Ask the host for a new link.
      </Notice>
    );
  }
  const preview = invite.preview;
  if (!preview) {
    return (
      <Shell>
        <p>Loading invite…</p>
      </Shell>
    );
  }

  const needsConsent = preview.agent !== "off";
  const canJoin =
    name.trim() !== "" &&
    (!needsConsent || agreed) &&
    mic === "ok" &&
    !invite.joining &&
    room.status !== "connecting";

  const checkMic = async () => {
    micRef.current?.stop();
    micRef.current = await props.startMic(setMic, setLevel);
  };

  return (
    <Shell>
      <p>
        <b>{preview.hostDisplayName}</b> invited you to a voice call.
      </p>
      <label className="field">
        Your name
        <input
          value={name}
          maxLength={60}
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {needsConsent && (
        <section aria-label="Consent">
          <p className="consent">{preview.consent.text}</p>
          <label>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{" "}
            I agree that {preview.agentName} listens and takes notes
          </label>
        </section>
      )}

      <section aria-label="Microphone check">
        <button onClick={() => void checkMic()} disabled={mic === "asking"}>
          {mic === "ok" ? "Check again" : "Check my microphone"}
        </button>
        {mic === "ok" && (
          <div
            className="meter"
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(level * 100)}
          >
            <div style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        )}
        {mic === "ok" && <p className="hint">Say something: the bar should move.</p>}
        {mic === "blocked" && (
          <p role="alert" className="error">
            The microphone is blocked. Allow it in your browser's address bar (the lock or camera
            icon), then check again.
          </p>
        )}
        {mic === "missing" && (
          <p role="alert" className="error">
            No microphone found. Connect one, then check again.
          </p>
        )}
      </section>

      <button
        className="primary"
        disabled={!canJoin}
        onClick={() => {
          unlockAudio();
          setLeft(false);
          invite.join(name.trim(), agreed).catch(() => {});
        }}
      >
        {invite.joining ? "Joining…" : "Join call"}
      </button>
      {invite.error && (
        <p role="alert" className="error">
          {classifyError(invite.error) === "invalid"
            ? "This link no longer works. Ask the host for a new one."
            : "Could not join: " + String(invite.error)}
        </p>
      )}
    </Shell>
  );
}
