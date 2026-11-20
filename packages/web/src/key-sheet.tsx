import type { CSSProperties } from "react";
import {
  defaultKeySheetTexts,
  resolveTheme,
  useAddKeySheet,
  type KeySheetTexts,
  type OpenBlahTheme,
  type UseAddKeySheetOptions,
} from "@openblah/core/react";

/** Props of the web `<OpenBlahAddKeySheet />`. @public */
export interface OpenBlahAddKeySheetProps extends UseAddKeySheetOptions {
  theme?: Partial<OpenBlahTheme>;
  /** Partial texts, merged over the English ones. */
  texts?: Partial<KeySheetTexts>;
  className?: string;
  style?: CSSProperties;
}

/**
 * The add-your-own-key sheet: Gemini first (free key, with the free-tier warning), then OpenAI
 * and Claude. One shared component: the standalone app uses it too. Themable with `theme`;
 * shown when your product's `who pays` mode asks the user for a key.
 * @public
 */
export function OpenBlahAddKeySheet(props: OpenBlahAddKeySheetProps) {
  const t = resolveTheme(props.theme);
  const x = { ...defaultKeySheetTexts, ...props.texts };
  const s = useAddKeySheet(props);
  const button: CSSProperties = {
    background: t.accent,
    color: t.accentText,
    border: 0,
    borderRadius: t.radius,
    padding: `${t.spacing}px ${t.spacing * 2}px`,
    fontSize: t.fontSize,
    cursor: "pointer",
  };
  const card = (background: string): CSSProperties => ({
    background,
    borderRadius: t.radius,
    padding: t.spacing,
    margin: `${t.spacing}px 0`,
  });

  return (
    <section
      role="dialog"
      aria-label={x.title}
      className={props.className}
      data-openblah-key-sheet=""
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
      <h2 style={{ margin: 0 }}>{x.title}</h2>
      {s.intro && <p>{s.intro}</p>}
      <p style={{ color: t.mutedText }}>{x.subscriptionNote}</p>

      <div role="radiogroup" style={{ display: "flex", gap: t.spacing, flexWrap: "wrap" }}>
        {s.providers.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={s.selected?.id === p.id}
            onClick={() => s.select(p.id)}
            style={{
              ...button,
              background: s.selected?.id === p.id ? t.accent : t.surface,
              color: s.selected?.id === p.id ? t.accentText : t.text,
            }}
          >
            {p.label}
            {p.recommended ? " ★" : ""}
          </button>
        ))}
      </div>

      {s.selected && <p style={{ color: t.mutedText }}>{s.selected.copy}</p>}

      {s.showFreeTierWarning && (
        <p role="note" style={card(t.warning)}>
          {x.freeTierWarning}
        </p>
      )}
      {s.selected?.id === "gemini" && (
        <label style={{ display: "block", margin: `${t.spacing}px 0` }}>
          <input
            type="checkbox"
            checked={s.paidGemini}
            onChange={(e) => s.setPaidGemini(e.target.checked)}
          />{" "}
          This is a paid Gemini key
        </label>
      )}
      {s.blocked && (
        <p role="alert" style={{ color: t.danger }}>
          {x.sensitiveRefusal}
        </p>
      )}

      {s.keyUrl && (
        <p>
          <a href={s.keyUrl} target="_blank" rel="noreferrer" style={{ color: t.accent }}>
            Get a key
          </a>
        </p>
      )}

      {s.fields.map((f) => (
        <label key={f} style={{ display: "block", margin: `${t.spacing}px 0` }}>
          {f} key
          <input
            type="password"
            autoComplete="off"
            value={s.values[f] ?? ""}
            onChange={(e) => s.setValue(f, e.target.value)}
            style={{
              display: "block",
              width: "100%",
              boxSizing: "border-box",
              marginTop: t.spacing / 2,
              padding: t.spacing,
              border: `1px solid ${t.border}`,
              borderRadius: t.radius,
              fontSize: t.fontSize,
            }}
          />
        </label>
      ))}

      {s.error && (
        <p role="alert" style={{ color: t.danger }}>
          {s.error}
        </p>
      )}
      <button
        style={{ ...button, opacity: s.canSubmit ? 1 : 0.5 }}
        disabled={!s.canSubmit}
        onClick={() => void s.submit().catch(() => {})}
      >
        {s.busy ? "Saving…" : "Save key"}
      </button>
    </section>
  );
}
