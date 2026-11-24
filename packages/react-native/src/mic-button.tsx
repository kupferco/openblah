import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  micHaloColor,
  micLabel,
  resolveLabels,
  resolveTheme,
  useMicButton,
  type OpenBlahMicButtonBaseProps,
} from "@openblah/core/react";

/** Props of the React Native `<OpenBlahMicButton />`. @public */
export interface OpenBlahMicButtonProps extends OpenBlahMicButtonBaseProps {
  style?: StyleProp<ViewStyle>;
}

/**
 * Drop-in voice mic button for React Native. Same behaviour as the web component: tap to start,
 * tap to end, one app-wide session, a halo for listening / thinking / speaking, a compact
 * confirmation card for write actions. Needs an Expo dev build.
 * @public
 */
export function OpenBlahMicButton(props: OpenBlahMicButtonProps) {
  const t = resolveTheme(props.theme);
  const l = resolveLabels(props.labels);
  const m = useMicButton(props);
  const size = props.size ?? 56;
  const halo = micHaloColor(m.state, t, props.haloColors);
  const pending = props.hideConfirmation ? undefined : m.approvals.pending[0];
  const pulse = useRef(new Animated.Value(0)).current;
  const live = m.state === "listening" || m.state === "thinking" || m.state === "speaking";

  useEffect(() => {
    if (!live) {
      pulse.setValue(0);
      return;
    }
    const ms = m.state === "speaking" ? 450 : m.state === "thinking" ? 800 : 1200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: ms, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: ms, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, m.state, pulse]);

  // The mic fades into a spinner while connecting, then back.
  const fade = useRef(new Animated.Value(1)).current;
  const connecting = m.state === "connecting";
  useEffect(() => {
    Animated.timing(fade, {
      toValue: connecting ? 0 : 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [connecting, fade]);

  const ring = size + 12;
  return (
    <View
      style={[
        { width: ring, height: ring, alignItems: "center", justifyContent: "center" },
        props.style,
      ]}
    >
      {halo && (
        <>
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              width: size + 6,
              height: size + 6,
              borderRadius: (size + 6) / 2,
              borderWidth: 3,
              borderColor: halo,
            }}
          />
          {live && (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                width: ring,
                height: ring,
                borderRadius: ring / 2,
                borderWidth: 2,
                borderColor: halo,
                opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.7] }),
                transform: [
                  { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }) },
                ],
              }}
            />
          )}
        </>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={m.active && m.state === "idle" ? l.micEnd : micLabel(m.state, l)}
        accessibilityState={{ selected: m.active, disabled: m.state === "connecting" }}
        disabled={m.state === "connecting"}
        onPress={() => void m.toggle()}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: t.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* A mic drawn from views, so no icon library is needed. */}
        <Animated.View
          style={{
            position: "absolute",
            opacity: fade.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          }}
        >
          <ActivityIndicator color={t.accentText} />
        </Animated.View>
        <Animated.View style={{ alignItems: "center", opacity: fade }}>
          <View
            style={{
              width: size * 0.2,
              height: size * 0.32,
              borderRadius: size * 0.1,
              backgroundColor: t.accentText,
            }}
          />
          <View
            style={{
              width: size * 0.34,
              height: size * 0.17,
              marginTop: -size * 0.06,
              borderBottomLeftRadius: size * 0.17,
              borderBottomRightRadius: size * 0.17,
              borderWidth: 2,
              borderTopWidth: 0,
              borderColor: t.accentText,
            }}
          />
          <View style={{ width: 2, height: size * 0.07, backgroundColor: t.accentText }} />
        </Animated.View>
      </Pressable>
      {m.failed && (
        <Text
          accessibilityRole="alert"
          style={{
            position: "absolute",
            top: ring + 4,
            width: 220,
            textAlign: "center",
            color: t.danger,
            fontSize: t.fontSize * 0.8125,
          }}
        >
          {l.micFailed}
        </Text>
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
          <View
            accessibilityRole="alert"
            style={{
              position: "absolute",
              bottom: ring + t.spacing,
              width: 240,
              backgroundColor: t.surface,
              borderColor: t.border,
              borderWidth: 1,
              borderRadius: t.radius,
              padding: t.spacing,
              gap: t.spacing,
            }}
          >
            <Text style={{ color: t.text, fontSize: t.fontSize * 0.875 }}>{pending.summary}</Text>
            <View style={{ flexDirection: "row", gap: t.spacing }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void m.approvals.approve(pending.id)}
                style={{
                  backgroundColor: t.accent,
                  borderRadius: t.radius,
                  paddingVertical: t.spacing / 2,
                  paddingHorizontal: t.spacing,
                }}
              >
                <Text style={{ color: t.accentText }}>{l.confirmYes}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void m.approvals.decline(pending.id)}
                style={{
                  borderColor: t.border,
                  borderWidth: 1,
                  borderRadius: t.radius,
                  paddingVertical: t.spacing / 2,
                  paddingHorizontal: t.spacing,
                }}
              >
                <Text style={{ color: t.text }}>{l.confirmNo}</Text>
              </Pressable>
            </View>
          </View>
        ))}
    </View>
  );
}
