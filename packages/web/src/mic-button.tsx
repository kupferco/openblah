import type { CSSProperties } from "react";
import {
  micHaloColor,
  micLabel,
  resolveLabels,
  resolveTheme,
  useMicButton,
  type OpenBlahMicButtonBaseProps,
} from "@openblah/core/react";

/** Props of the web `<OpenBlahMicButton />`. @public */
export interface OpenBlahMicButtonProps extends OpenBlahMicButtonBaseProps {
  className?: string;
  style?: CSSProperties;
}

const MIC_PATH =
  "M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z";

/**
 * Drop-in voice mic button. Tap to start a voice session, tap again to end it; it never starts a
 * second one. The session is app-wide (it lives in `<OpenBlahProvider>`), so every instance shows
 * the same state and it survives navigation. A halo shows listening, thinking or speaking; a
 * compact card confirms write actions. No transcript, no call screen.
 * @public
 */
export function OpenBlahMicButton(props: OpenBlahMicButtonProps) {
  const t = resolveTheme(props.theme);
  const l = resolveLabels(props.labels);
  const m = useMicButton(props);
  const size = props.size ?? 56;
  const halo = micHaloColor(m.state, t, props.haloColors);
  const pending = props.hideConfirmation ? undefined : m.approvals.pending[0];
  const label = m.active && m.state === "idle" ? l.micEnd : micLabel(m.state, l);
  const pulse = m.state !== "idle" && m.state !== "connecting";

  return (
    <span
      className={props.className}
      data-openblah-mic=""
      data-state={m.state}
      style={{ position: "relative", display: "inline-flex", ...props.style }}
    >
      <style>{`@keyframes openblah-mic-halo{0%,100%{box-shadow:0 0 0 2px var(--ob-halo),0 0 0 4px transparent}50%{box-shadow:0 0 0 2px var(--ob-halo),0 0 0 7px color-mix(in srgb,var(--ob-halo) 35%,transparent)}}@keyframes openblah-mic-spin{to{transform:rotate(360deg)}}[data-openblah-mic] .ob-icon{transition:opacity .25s ease;position:absolute}@media (prefers-reduced-motion:reduce){[data-openblah-mic] .ob-icon{transition:none}[data-openblah-mic] .ob-spin{animation:none!important}}@media (prefers-reduced-motion:reduce){[data-openblah-mic] button{animation:none!important}}`}</style>
      <button
        type="button"
        aria-label={label}
        aria-pressed={m.active}
        disabled={m.state === "connecting"}
        onClick={() => void m.toggle()}
        style={
          {
            width: size,
            height: size,
            borderRadius: "50%",
            border: 0,
            padding: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            background: t.accent,
            color: t.accentText,
            "--ob-halo": halo ?? "transparent",
            boxShadow: halo ? `0 0 0 3px ${halo}` : "none",
            animation: pulse
              ? `openblah-mic-halo ${m.state === "speaking" ? 0.9 : m.state === "thinking" ? 1.6 : 2.4}s ease-in-out infinite`
              : undefined,
          } as CSSProperties
        }
      >
        {/* The mic fades into a spinner while connecting, then back to the live mic. */}
        <svg
          className="ob-icon"
          width={size * 0.5}
          height={size * 0.5}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
          style={{ opacity: m.state === "connecting" ? 0 : 1 }}
        >
          <path d={MIC_PATH} />
        </svg>
        <svg
          className="ob-icon ob-spin"
          width={size * 0.5}
          height={size * 0.5}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          aria-hidden
          data-openblah-spinner=""
          style={{
            opacity: m.state === "connecting" ? 1 : 0,
            animation:
              m.state === "connecting" ? "openblah-mic-spin .8s linear infinite" : undefined,
          }}
        >
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      </button>
      {m.failed && (
        <span
          role="alert"
          style={{
            position: "absolute",
            top: size + t.spacing / 2,
            left: "50%",
            transform: "translateX(-50%)",
            width: "max-content",
            maxWidth: 220,
            fontSize: t.fontSize * 0.8125,
            color: t.danger,
            textAlign: "center",
          }}
        >
          {l.micFailed}
        </span>
      )}
      {pending &&
        (props.renderConfirmation ? (
          props.renderConfirmation({
            id: pending.id,
            summary: pending.summary,
            approve: () => void m.approvals.approve(pending.id),
            decline: () => void m.approvals.decline(pending.id),
          })
        ) : (
          <span
            role="alertdialog"
            aria-label={pending.summary}
            style={{
              position: "absolute",
              bottom: size + t.spacing * 1.5,
              left: "50%",
              transform: "translateX(-50%)",
              width: "max-content",
              maxWidth: 260,
              background: t.surface,
              color: t.text,
              border: `1px solid ${t.border}`,
              borderRadius: t.radius,
              padding: t.spacing,
              fontSize: t.fontSize * 0.875,
              display: "flex",
              flexDirection: "column",
              gap: t.spacing,
            }}
          >
            <span>{pending.summary}</span>
            <span style={{ display: "flex", gap: t.spacing }}>
              <button
                type="button"
                onClick={() => void m.approvals.approve(pending.id)}
                style={{
                  background: t.accent,
                  color: t.accentText,
                  border: 0,
                  borderRadius: t.radius,
                  padding: `${t.spacing / 2}px ${t.spacing}px`,
                  cursor: "pointer",
                }}
              >
                {l.confirmYes}
              </button>
              <button
                type="button"
                onClick={() => void m.approvals.decline(pending.id)}
                style={{
                  background: "transparent",
                  color: t.text,
                  border: `1px solid ${t.border}`,
                  borderRadius: t.radius,
                  padding: `${t.spacing / 2}px ${t.spacing}px`,
                  cursor: "pointer",
                }}
              >
                {l.confirmNo}
              </button>
            </span>
          </span>
        ))}
    </span>
  );
}
