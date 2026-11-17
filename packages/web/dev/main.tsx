import { createRoot } from "react-dom/client";
import { useState } from "react";
import {
  OpenBlahProvider,
  useAgentState,
  useMute,
  useParticipants,
  useRoom,
  useToolApprovals,
} from "../src/react.js";

function Page() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const { status, error, connect, disconnect } = useRoom();
  const participants = useParticipants();
  const agent = useAgentState();
  const { pending, approve, decline } = useToolApprovals();
  const { muted, toggle } = useMute();
  const joined = status === "connected";

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 480, margin: "2rem auto" }}>
      <h1>OpenBlah dev page</h1>
      <p>
        Paste the LiveKit URL and a token from the server (<code>POST /v1/tokens</code>), then join.
        Open a second tab with another token to talk to yourself.
      </p>
      <input
        placeholder="wss://your-project.livekit.cloud"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        style={{ width: "100%" }}
      />
      <textarea
        placeholder="token"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        rows={4}
        style={{ width: "100%" }}
      />
      <div>
        <button
          disabled={joined || status === "connecting" || !url || !token}
          onClick={() => connect(url, token).catch(() => {})}
        >
          Join
        </button>{" "}
        <button disabled={!joined} onClick={() => void disconnect()}>
          Leave
        </button>{" "}
        <button disabled={!joined} onClick={() => void toggle()}>
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
      <p>
        Status: {status} · Agent: {agent}
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
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {participants.map((p) => (
          <li key={p.identity}>
            {p.name}
            {p.isLocal ? " (you)" : ""}
            {p.isAgent ? " [agent]" : ""}
            {p.isMuted ? " · muted" : ""}
            {p.isSpeaking ? " · speaking" : ""}
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <OpenBlahProvider>
    <Page />
  </OpenBlahProvider>,
);
