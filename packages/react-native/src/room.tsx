import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import {
  resolveLabels,
  resolveTheme,
  useRoomView,
  type OpenBlahRoomBaseProps,
  type OpenBlahTheme,
} from "@openblah/core/react";
import { shareInvite } from "./invite.js";

/** Props of the React Native `<OpenBlahRoom />`. Same as the web component, with `style` for a View. @public */
export interface OpenBlahRoomProps extends OpenBlahRoomBaseProps {
  style?: StyleProp<ViewStyle>;
  /** Extra content shown under the controls, for example your own transcript. */
  children?: ReactNode;
}

function Btn(props: {
  label: string;
  onPress: () => void;
  t: OpenBlahTheme;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { t } = props;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        backgroundColor: props.primary ? t.accent : t.surface,
        borderRadius: t.radius,
        paddingVertical: t.spacing,
        paddingHorizontal: t.spacing * 2,
        opacity: props.disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color: props.primary ? t.accentText : t.text, fontSize: t.fontSize }}>
        {props.label}
      </Text>
    </Pressable>
  );
}

/**
 * The ready-made call screen: join, mute, participants, agent state, consent, invite, agent
 * control and tool approvals. Must be inside `<OpenBlahProvider>`. Same props and behaviour as
 * the web component; the invite opens the system share sheet. Needs an Expo dev build.
 * @public
 */
export function OpenBlahRoom(props: OpenBlahRoomProps) {
  const t = resolveTheme(props.theme);
  const l = resolveLabels(props.labels);
  const hidden = new Set(props.hide ?? []);
  const v = useRoomView(props);
  const [note, setNote] = useState<string | null>(null);

  const text = { color: t.text, fontSize: t.fontSize };
  const row = { flexDirection: "row", flexWrap: "wrap", gap: t.spacing } as const;
  const card = (backgroundColor: string) =>
    ({
      backgroundColor,
      borderRadius: t.radius,
      padding: t.spacing,
      gap: t.spacing,
    }) as const;

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: t.background,
          borderColor: t.border,
          borderRadius: t.radius,
          padding: t.spacing * 2,
          gap: t.spacing,
        },
        props.style,
      ]}
    >
      {v.pause.paused && !hidden.has("pause") && (
        <View style={card(t.warning)}>
          <Text style={[text, styles.bold]}>{l.aiPaused}</Text>
        </View>
      )}

      <View style={row}>
        {!v.connected ? (
          <Btn
            t={t}
            primary
            disabled={v.joining}
            label={v.joining ? l.joining : l.join}
            onPress={() => void v.join()}
          />
        ) : (
          <>
            <Btn t={t} label={l.leave} onPress={() => void v.leave()} />
            {!hidden.has("mute") && (
              <Btn
                t={t}
                primary
                label={v.mute.muted ? l.unmute : l.mute}
                onPress={() => void v.mute.toggle()}
              />
            )}
            {!hidden.has("pause") && (
              <Btn
                t={t}
                label={v.pause.paused ? l.resumeAi : l.pauseAi}
                onPress={() => void v.pause.toggle()}
              />
            )}
            {!hidden.has("invite") && v.host.isHost && (
              <Btn
                t={t}
                label={l.invite}
                onPress={() =>
                  shareInvite(v.host)
                    .then(() => setNote(null))
                    .catch((e: Error) => setNote(e.message))
                }
              />
            )}
          </>
        )}
      </View>

      {note && <Text style={{ color: t.danger, fontSize: t.fontSize }}>{note}</Text>}
      {v.error && <Text style={{ color: t.danger, fontSize: t.fontSize }}>{v.error}</Text>}

      {v.connected && !hidden.has("agentState") && (
        <Text style={{ color: t.mutedText, fontSize: t.fontSize }}>
          {l.agentState}: {v.agentState}
        </Text>
      )}

      {v.connected &&
        !hidden.has("approvals") &&
        v.approvals.pending.map((a) => (
          <View key={a.id} style={card(t.surface)}>
            <Text style={[text, styles.bold]}>
              {l.confirmAction} {a.summary}
            </Text>
            <View style={row}>
              <Btn
                t={t}
                primary
                label={l.confirmYes}
                onPress={() => void v.approvals.approve(a.id)}
              />
              <Btn t={t} label={l.confirmNo} onPress={() => void v.approvals.decline(a.id)} />
            </View>
          </View>
        ))}

      {v.connected && !hidden.has("consent") && v.consent.needed && v.consent.text && (
        <View style={card(t.surface)}>
          <Text style={text}>{v.consent.text}</Text>
          <Btn t={t} primary label={l.consentAccept} onPress={() => void v.consent.accept()} />
        </View>
      )}

      {v.connected && !hidden.has("agentControl") && v.control.state && (
        <View style={{ gap: t.spacing }}>
          {v.control.state.awaitingConsent && (
            <View style={card(t.warning)}>
              <Text style={text}>
                {l.waitingForConsent} {v.control.state.missing.map((m) => m.displayName).join(", ")}
              </Text>
            </View>
          )}
          <View style={row}>
            {!v.control.present && (
              <Btn
                t={t}
                label={v.control.state.canControl ? l.bringInAgent : l.askForAgent}
                onPress={() => void v.control.bringIn().catch(() => {})}
              />
            )}
            {v.control.present && v.control.state.canControl && (
              <Btn t={t} label={l.sendAgentOut} onPress={() => void v.control.sendOut()} />
            )}
          </View>
          {v.control.requests.map((r) => (
            <View key={r.id} style={card(t.surface)}>
              <Text style={text}>
                {r.displayName} {l.requestsAgent}
              </Text>
              <View style={row}>
                <Btn t={t} primary label={l.approve} onPress={() => void v.control.approve(r.id)} />
                <Btn t={t} label={l.decline} onPress={() => void v.control.decline(r.id)} />
              </View>
            </View>
          ))}
        </View>
      )}

      {v.connected &&
        !hidden.has("participants") &&
        v.participants.map((p) => (
          <View key={p.identity} style={row}>
            <Text style={[text, p.isSpeaking ? styles.bold : null]}>
              {p.name}
              {p.isLocal ? ` (${l.you})` : ""}
              {p.isAgent ? ` [${l.agent}]` : ` [${p.role}]`}
              {p.isMuted ? ` · ${l.muted}` : ""}
              {p.isSpeaking ? ` · ${l.speaking}` : ""}
            </Text>
            {v.host.isHost && !p.isLocal && !p.isAgent && (
              <Btn
                t={t}
                label={l.remove}
                onPress={() => void v.host.removeParticipant(p.identity)}
              />
            )}
          </View>
        ))}

      {v.connected && !hidden.has("endRoom") && v.host.isHost && (
        <Btn t={t} label={l.endRoom} onPress={() => void v.host.endRoom().then(() => v.leave())} />
      )}
      {props.children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderWidth: 1 },
  bold: { fontWeight: "700" },
});
