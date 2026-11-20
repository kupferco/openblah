import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  defaultKeySheetTexts,
  resolveTheme,
  useAddKeySheet,
  type KeySheetTexts,
  type OpenBlahTheme,
  type UseAddKeySheetOptions,
} from "@openblah/core/react";

/** Props of the React Native `<OpenBlahAddKeySheet />`. Same as the web component. @public */
export interface OpenBlahAddKeySheetProps extends UseAddKeySheetOptions {
  theme?: Partial<OpenBlahTheme>;
  /** Partial texts, merged over the English ones. */
  texts?: Partial<KeySheetTexts>;
  style?: StyleProp<ViewStyle>;
}

/**
 * The add-your-own-key sheet: Gemini first (free key, with the free-tier warning), then OpenAI
 * and Claude. The same flow as the web component and the standalone app. Put it in a `Modal`
 * or a bottom sheet of your choice.
 * @public
 */
export function OpenBlahAddKeySheet(props: OpenBlahAddKeySheetProps) {
  const t = resolveTheme(props.theme);
  const x = { ...defaultKeySheetTexts, ...props.texts };
  const s = useAddKeySheet(props);
  const text = { color: t.text, fontSize: t.fontSize };
  const muted = { color: t.mutedText, fontSize: t.fontSize };
  const btn = (primary: boolean, disabled = false) =>
    ({
      backgroundColor: primary ? t.accent : t.surface,
      borderRadius: t.radius,
      paddingVertical: t.spacing,
      paddingHorizontal: t.spacing * 2,
      opacity: disabled ? 0.5 : 1,
    }) as const;

  return (
    <ScrollView
      style={[
        { backgroundColor: t.background, borderRadius: t.radius, padding: t.spacing * 2 },
        props.style,
      ]}
      contentContainerStyle={{ gap: t.spacing }}
    >
      <Text style={[text, { fontWeight: "700" }]}>{x.title}</Text>
      {s.intro && <Text style={text}>{s.intro}</Text>}
      <Text style={muted}>{x.subscriptionNote}</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.spacing }}>
        {s.providers.map((p) => {
          const on = s.selected?.id === p.id;
          return (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => s.select(p.id)}
              style={btn(on)}
            >
              <Text style={{ color: on ? t.accentText : t.text, fontSize: t.fontSize }}>
                {p.label}
                {p.recommended ? " ★" : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {s.selected && <Text style={muted}>{s.selected.copy}</Text>}
      {s.showFreeTierWarning && (
        <View style={{ backgroundColor: t.warning, borderRadius: t.radius, padding: t.spacing }}>
          <Text style={text}>{x.freeTierWarning}</Text>
        </View>
      )}
      {s.selected?.id === "gemini" && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: s.paidGemini }}
          onPress={() => s.setPaidGemini(!s.paidGemini)}
        >
          <Text style={text}>{s.paidGemini ? "☑" : "☐"} This is a paid Gemini key</Text>
        </Pressable>
      )}
      {s.blocked && (
        <Text style={{ color: t.danger, fontSize: t.fontSize }}>{x.sensitiveRefusal}</Text>
      )}
      {s.keyUrl && <Text style={{ color: t.accent, fontSize: t.fontSize }}>{s.keyUrl}</Text>}

      {s.fields.map((f) => (
        <View key={f} style={{ gap: t.spacing / 2 }}>
          <Text style={text}>{f} key</Text>
          <TextInput
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            value={s.values[f] ?? ""}
            onChangeText={(v) => s.setValue(f, v)}
            style={{
              ...text,
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: t.radius,
              padding: t.spacing,
            }}
          />
        </View>
      ))}

      {s.error && <Text style={{ color: t.danger, fontSize: t.fontSize }}>{s.error}</Text>}
      <Pressable
        accessibilityRole="button"
        disabled={!s.canSubmit}
        onPress={() => void s.submit().catch(() => {})}
        style={btn(true, !s.canSubmit)}
      >
        <Text style={{ color: t.accentText, fontSize: t.fontSize }}>
          {s.busy ? "Saving…" : "Save key"}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
