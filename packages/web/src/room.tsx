import { useState, type CSSProperties, type ReactNode } from "react";
import {
  resolveLabels,
  resolveTheme,
  useRoomView,
  type OpenBlahRoomBaseProps,
} from "@openblah/core/react";
import { copyInviteLink } from "./invite.js";

/** Props of the web `<OpenBlahRoom />`. @public */
export interface OpenBlahRoomProps extends OpenBlahRoomBaseProps {
  className?: string;
  style?: CSSProperties;
  /** Extra content shown under the controls, for example your own transcript. */
  children?: ReactNode;
}

/**
 * The ready-made call screen: join, mute, participants, agent state, consent, invite, agent
 * control and tool approvals. Must be inside `<OpenBlahProvider>`. Themable with `theme` and
 * `labels`; hide a part with `hide` and build your own with the hooks.
 * @public
 */
export function OpenBlahRoom(props: OpenBlahRoomProps) {
  const t = resolveTheme(props.theme);
  const l = resolveLabels(props.labels);
  const hidden = new Set(props.hide ?? []);
  const v = useRoomView(props);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);

  const button: CSSProperties = {
    background: t.accent,
    color: t.accentText,
    border: 0,
    borderRadius: t.radius,
    padding: `${t.spacing}px ${t.spacing * 2}px`,
    fontSize: t.fontSize,
    cursor: "pointer",
  };
  const plain: CSSProperties = { ...button, background: t.surface, color: t.text };
  const card = (background: string): CSSProperties => ({
    background,
    color: t.text,
    borderRadius: t.radius,
    padding: t.spacing,
    margin: `${t.spacing}px 0`,
  });

  return (
    <section
      className={props.className}
      data-openblah-room=""
      style={{
        background: t.background,
        color: t.text,
        fontSize: t.fontSize,
        border: `1px solid ${t.border}`,
        borderRadius: t.radius,
        padding: t.spacing * 2,
        fontFamily: "system-ui, sans-serif",
        ...props.style,
      }}
    >
      {v.pause.paused && !hidden.has("pause") && (
        <p role="status" style={{ ...card(t.warning), fontWeight: 600 }}>
          {l.aiPaused}
        </p>
      )}

      <div style={{ display: "flex", gap: t.spacing, flexWrap: "wrap" }}>
        {!v.connected ? (
          <button style={button} disabled={v.joining} onClick={() => void v.join()}>
            {v.joining ? l.joining : l.join}
          </button>
        ) : (
          <>
            <button style={plain} onClick={() => void v.leave()}>
              {l.leave}
            </button>
            {!hidden.has("mute") && (
              <button style={button} onClick={() => void v.mute.toggle()}>
                {v.mute.muted ? l.unmute : l.mute}
              </button>
            )}
            {!hidden.has("pause") && (
              <button style={plain} onClick={() => void v.pause.toggle()}>
                {v.pause.paused ? l.resumeAi : l.pauseAi}
              </button>
            )}
            {!hidden.has("invite") && v.host.isHost && (
              <button
                style={plain}
                onClick={() =>
                  copyInviteLink(v.host)
                    .then((i) => (setLink(i), setNote(l.inviteCopied)))
                    .catch((e: Error & { invite?: { id: string; url: string } }) => {
                      if (e.invite) setLink(e.invite);
                      setNote(e.message);
                    })
                }
              >
                {l.invite}
              </button>
            )}
          </>
        )}
      </div>

      {!hidden.has("invite") && link && (
        <p>
          <a href={link.url} style={{ color: t.accent }}>
            {link.url}
          </a>{" "}
          <span style={{ color: t.mutedText }}>{note}</span>{" "}
          <button
            style={plain}
            onClick={() => void v.host.revokeInvite(link.id).then(() => setLink(null))}
          >
            {l.inviteRevoke}
          </button>
        </p>
      )}

      {v.error && (
        <p role="alert" style={{ color: t.danger }}>
          {v.error}
        </p>
      )}

      {v.connected && !hidden.has("agentState") && (
        <p style={{ color: t.mutedText }}>
          {l.agentState}: {v.agentState}
        </p>
      )}

      {v.connected &&
        !hidden.has("approvals") &&
        v.approvals.pending.map((a) => (
          <div key={a.id} role="alertdialog" style={card(t.surface)}>
            <strong>
              {l.confirmAction} {a.summary}
            </strong>
            <div style={{ display: "flex", gap: t.spacing, marginTop: t.spacing }}>
              <button style={button} onClick={() => void v.approvals.approve(a.id)}>
                {l.confirmYes}
              </button>
              <button style={plain} onClick={() => void v.approvals.decline(a.id)}>
                {l.confirmNo}
              </button>
            </div>
          </div>
        ))}

      {v.connected && !hidden.has("consent") && v.consent.needed && v.consent.text && (
        <div style={card(t.surface)}>
          <p>{v.consent.text}</p>
          <button style={button} onClick={() => void v.consent.accept()}>
            {l.consentAccept}
          </button>
        </div>
      )}

      {v.connected && !hidden.has("agentControl") && v.control.state && (
        <div>
          {v.control.state.awaitingConsent && (
            <p style={card(t.warning)}>
              {l.waitingForConsent} {v.control.state.missing.map((m) => m.displayName).join(", ")}
            </p>
          )}
          {!v.control.present && (
            <button style={plain} onClick={() => void v.control.bringIn().catch(() => {})}>
              {v.control.state.canControl ? l.bringInAgent : l.askForAgent}
            </button>
          )}
          {v.control.present && v.control.state.canControl && (
            <button style={plain} onClick={() => void v.control.sendOut()}>
              {l.sendAgentOut}
            </button>
          )}
          {v.control.requests.map((r) => (
            <p key={r.id} style={card(t.surface)}>
              {r.displayName} {l.requestsAgent}{" "}
              <button style={button} onClick={() => void v.control.approve(r.id)}>
                {l.approve}
              </button>{" "}
              <button style={plain} onClick={() => void v.control.decline(r.id)}>
                {l.decline}
              </button>
            </p>
          ))}
        </div>
      )}

      {v.connected && !hidden.has("participants") && (
        <ul style={{ paddingLeft: t.spacing * 2 }}>
          {v.participants.map((p) => (
            <li key={p.identity} style={{ fontWeight: p.isSpeaking ? 700 : 400 }}>
              {p.name}
              {p.isLocal ? ` (${l.you})` : ""}
              {p.isAgent ? ` [${l.agent}]` : ` [${p.role}]`}
              {p.isMuted ? ` · ${l.muted}` : ""}
              {p.isSpeaking ? ` · ${l.speaking}` : ""}{" "}
              {v.host.isHost && !p.isLocal && !p.isAgent && (
                <button style={plain} onClick={() => void v.host.removeParticipant(p.identity)}>
                  {l.remove}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {v.connected && !hidden.has("endRoom") && v.host.isHost && (
        <button
          style={{ ...plain, color: t.danger }}
          onClick={() => void v.host.endRoom().then(() => v.leave())}
        >
          {l.endRoom}
        </button>
      )}
      {props.children}
    </section>
  );
}
