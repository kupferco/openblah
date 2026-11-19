import type { ReactNode } from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";

/** Small shared building blocks so every screen looks the same. */
export function Screen(props: { title: string; children: ReactNode }) {
  return (
    <SafeAreaView style={s.screen}>
      <Text accessibilityRole="header" style={s.title}>
        {props.title}
      </Text>
      <View style={s.body}>{props.children}</View>
    </SafeAreaView>
  );
}

export function Body(props: { children: ReactNode; muted?: boolean }) {
  return <Text style={props.muted ? s.muted : s.text}>{props.children}</Text>;
}

export function ErrorText(props: { error: string | null | undefined }) {
  return props.error ? (
    <Text accessibilityRole="alert" style={s.error}>
      {props.error}
    </Text>
  ) : null;
}

export function Button(props: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[s.button, props.primary ? s.primary : s.secondary, props.disabled && s.disabled]}
    >
      <Text style={props.primary ? s.primaryText : s.text}>{props.label}</Text>
    </Pressable>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  secure?: boolean;
  keyboard?: "default" | "email-address";
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={s.muted}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        style={s.input}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={props.secure ?? false}
        keyboardType={props.keyboard ?? "default"}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "700", padding: 16 },
  body: { flex: 1, paddingHorizontal: 16, gap: 12 },
  text: { fontSize: 16, color: "#111" },
  muted: { fontSize: 14, color: "#666" },
  error: { fontSize: 14, color: "#b00020" },
  button: { borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center" },
  primary: { backgroundColor: "#2f5bea" },
  secondary: { backgroundColor: "#eef0f6" },
  primaryText: { fontSize: 16, color: "#fff", fontWeight: "600" },
  disabled: { opacity: 0.5 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 8, padding: 10, fontSize: 16 },
});
