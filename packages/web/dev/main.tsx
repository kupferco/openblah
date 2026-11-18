import { createRoot } from "react-dom/client";
import { useMemo, useRef, useState } from "react";
import { OpenBlahClient } from "../src/index.js";
import { copyInviteLink } from "../src/invite.js";
import {
  OpenBlahProvider,
  useAgentControl,
  useAgentState,
  useAiPause,
  useConsent,
  useHostControls,
  useInviteJoin,
  useInviteRequests,
  useMute,
  useParticipants,
  useRole,
  useRoom,
  useToolApprovals,
} from "../src/react.js";

/** Pasted invite link or bare token: the token is the last path segment. */
function tokenFrom(input: string): string {
  return input.trim().split(/[/?#]/).filter(Boolean).pop() ?? "";
}

const box = { width: "100%", boxSizing: "border-box" } as const;

function Page(props: { apiKey: string }) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const { status, error, connect, disconnect } = useRoom();
  const participants = useParticipants();
  const agent = useAgentState();
  const { pending, approve, decline } = useToolApprovals();
  const role = useRole();
  const { muted, toggle } = useMute();
  const pause = useAiPause();
  const host = useHostControls();
  const consent = useConsent();
  const control = useAgentControl();
  const joined = status === "connected";

  // Guest side
  const [inviteInput, setInviteInput] = useState("");
  const [guestName, setGuestName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const invite = useInviteJoin(inviteInput ? tokenFrom(inviteInput) : null);

  // Host side
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [note, setNote] = useState("");
  const [request, setRequest] = useState<{
    who: string;
    answer: (s: "sent" | "declined") => void;
  } | null>(null);
  useInviteRequests(
    (req) =>
      new Promise((resolve) =>
        setRequest({ who: req.who, answer: (s) => (setRequest(null), resolve(s)) }),
      ),
  );

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 520, margin: "2rem auto" }}>
      <h1>OpenBlah dev page</h1>
      {pause.paused && (
        <p style={{ background: "#fde68a", padding: 8, fontWeight: 600 }}>
          AI paused: nobody is being listened to.
        </p>
      )}

      {!joined && (
        <>
          <h2>Join as host or member</h2>
          <p>
            Paste the LiveKit URL and a token from the server (<code>POST /v1/tokens</code>), then
            join.
          </p>
          <input
            placeholder="wss://your-project.livekit.cloud"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={box}
          />
          <textarea
            placeholder="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            style={box}
          />
          <button
            disabled={status === "connecting" || !url || !token}
            onClick={() => connect(url, token).catch(() => {})}
          >
            Join
          </button>

          <h2>Join as guest with an invite</h2>
          <input
            placeholder="invite link or token"
            value={inviteInput}
            onChange={(e) => setInviteInput(e.target.value)}
            style={box}
          />
          {invite.preview && (
            <>
              <p>
                Invited by <b>{invite.preview.hostDisplayName}</b>. AI: {invite.preview.agent}
              </p>
              <blockquote style={{ margin: "8px 0" }}>{invite.preview.consent.text}</blockquote>
              <label>
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />{" "}
                I agree that {invite.preview.agentName} listens and takes notes
              </label>
              <input
                placeholder="your name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                style={box}
              />
              <button
                disabled={
                  invite.joining || !guestName.trim() || (!agreed && invite.preview.agent !== "off")
                }
                onClick={() => invite.join(guestName.trim(), agreed).catch(() => {})}
              >
                Join as guest
              </button>
            </>
          )}
          {invite.error && <p style={{ color: "crimson" }}>{invite.error}</p>}
        </>
      )}

      {joined && (
        <>
          <div>
            <button onClick={() => void disconnect()}>Leave</button>{" "}
            <button onClick={() => void toggle()}>{muted ? "Unmute" : "Mute"}</button>{" "}
            <button onClick={() => void pause.toggle()}>
              {pause.paused ? "Resume AI" : "Pause AI"}
            </button>
          </div>
          <p>
            Status: {status} · You: {role} · Agent: {agent}
          </p>
          {pending.map((a) => (
            <div
              key={a.id}
              role="alertdialog"
              style={{ border: "2px solid #c80", padding: "0.5rem", margin: "0.5rem 0" }}
            >
              <strong>Confirm: {a.summary}</strong>
              <div>
                <button onClick={() => void approve(a.id)}>Yes, do it</button>{" "}
                <button onClick={() => void decline(a.id)}>Cancel</button>
              </div>
            </div>
          ))}
          {consent.needed && consent.text && (
            <p style={{ background: "#e0f2fe", padding: 8 }}>
              {consent.text} <button onClick={() => void consent.accept()}>I agree</button>
            </p>
          )}
          {control.state && (
            <section>
              <h2>
                Agent: {control.state.agent}
                {control.present ? " (in the call)" : ""}
              </h2>
              {control.state.awaitingConsent && (
                <p style={{ background: "#fef9c3", padding: 8 }}>
                  Waiting for consent, nobody is being listened to. Missing:{" "}
                  {control.state.missing.map((m) => m.displayName).join(", ")}
                </p>
              )}
              {!control.present && (
                <button onClick={() => void control.bringIn().then((r) => setNote(r.status))}>
                  {control.state.canControl ? "Bring in the agent" : "Ask the host to bring it in"}
                </button>
              )}
              {control.state.agent === "on" && control.state.canControl && (
                <button onClick={() => void control.sendOut()}>Send the agent out</button>
              )}
              {control.requests.map((r) => (
                <p key={r.id} style={{ background: "#dcfce7", padding: 8 }}>
                  {r.displayName} asks to bring the agent in.{" "}
                  <button onClick={() => void control.approve(r.id)}>Approve</button>{" "}
                  <button onClick={() => void control.decline(r.id)}>Decline</button>
                </p>
              ))}
              {control.isHost && (
                <p>
                  <label>
                    <input
                      type="checkbox"
                      checked={control.state.anyoneCanAddAgent}
                      onChange={(e) => void control.setAnyoneCanAdd(e.target.checked)}
                    />{" "}
                    Anyone can add the agent
                  </label>{" "}
                  Idle timeout (minutes):{" "}
                  <input
                    type="number"
                    min={1}
                    style={{ width: 60 }}
                    defaultValue={Math.round(control.state.idleTimeoutSeconds / 60)}
                    onBlur={(e) =>
                      e.target.value &&
                      void control.setIdleTimeoutSeconds(Number(e.target.value) * 60)
                    }
                  />
                </p>
              )}
            </section>
          )}
          {host.isHost && (
            <section>
              <h2>Host</h2>
              <button
                onClick={() =>
                  copyInviteLink(host)
                    .then((i) => (setLink(i), setNote("Link copied")))
                    .catch((e: Error & { invite?: { id: string; url: string } }) => {
                      if (e.invite) setLink(e.invite);
                      setNote(e.message);
                    })
                }
              >
                Invite (copy link)
              </button>
              {link && (
                <p>
                  <a href={link.url}>{link.url}</a> {note}{" "}
                  <button onClick={() => host.revokeInvite(link.id).then(() => setLink(null))}>
                    Revoke
                  </button>
                </p>
              )}
              {request && (
                <p style={{ background: "#dcfce7", padding: 8 }}>
                  The agent asks to invite “{request.who}”.{" "}
                  <button
                    onClick={() =>
                      host
                        .createInvite()
                        .then((i) => navigator.clipboard.writeText(i.url).then(() => setLink(i)))
                        .then(() => request.answer("sent"))
                    }
                  >
                    Copy link and send
                  </button>{" "}
                  <button onClick={() => request.answer("declined")}>Decline</button>
                </p>
              )}
              <button onClick={() => void host.endRoom().then(() => disconnect())}>
                End room for everyone
              </button>
            </section>
          )}
        </>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {participants.map((p) => (
          <li key={p.identity}>
            {p.name}
            {p.isLocal ? " (you)" : ""}
            {p.isAgent ? " [agent]" : ` [${p.role}]`}
            {p.isMuted ? " · muted" : ""}
            {p.isSpeaking ? " · speaking" : ""}{" "}
            {host.isHost && !p.isLocal && !p.isAgent && (
              <button onClick={() => void host.removeParticipant(p.identity)}>Remove</button>
            )}
          </li>
        ))}
      </ul>
      <small>
        API key is sent only to the server URL above.{props.apiKey ? "" : " (none set)"}
      </small>
    </main>
  );
}

function Root() {
  const params = new URLSearchParams(location.search);
  const [apiUrl, setApiUrl] = useState(params.get("api") ?? "http://localhost:8080/v1");
  const [apiKey, setApiKey] = useState(params.get("key") ?? "");
  const keyRef = useRef(apiKey);
  keyRef.current = apiKey;
  const client = useMemo(
    () =>
      new OpenBlahClient({
        // Dev only: a real app keeps the API key on its backend (see docs/api.md).
        // The key is read at call time, so changing it needs no new client.
        api: {
          baseUrl: apiUrl,
          headers: (): Record<string, string> =>
            keyRef.current ? { authorization: `Bearer ${keyRef.current}` } : {},
        },
      }),
    [apiUrl],
  );
  return (
    <>
      <details style={{ fontFamily: "sans-serif", maxWidth: 520, margin: "1rem auto" }}>
        <summary>OpenBlah server (for invites, consent and host controls)</summary>
        <input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} style={box} />
        <input
          placeholder="API key (dev only)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={box}
        />
      </details>
      <OpenBlahProvider client={client}>
        <Page apiKey={apiKey} />
      </OpenBlahProvider>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
