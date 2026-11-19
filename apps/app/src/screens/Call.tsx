import { useEffect, useRef, useState } from "react";
import {
  useAgentControl,
  useAgentState,
  useConsent,
  useMute,
  useParticipants,
  useRoom,
  useRoomMode,
  type OpenBlahApi,
  type RoomMode,
} from "@openblah/react-native";
import { Body, Button, ErrorText, Screen } from "../ui.js";

/**
 * The call: starts a room, joins it and shows participants, the agent's state, mute, agent in or
 * out, and the Listening / Direct switch. Uses only the SDK's public hooks.
 */
export function CallScreen(props: {
  api: OpenBlahApi;
  displayName: string;
  agentName: string;
  /** LiveKit URL to use when the server sends none. */
  livekitUrl: string;
  onLeave: () => void;
}) {
  const room = useRoom();
  const participants = useParticipants();
  const agentState = useAgentState();
  const mute = useMute();
  const control = useAgentControl();
  const consent = useConsent();
  const mode = useRoomMode();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const connect = useRef(room.connect);
  connect.current = room.connect;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const call = await props.api.startCall({
        displayName: props.displayName,
        agentName: props.agentName,
      });
      await connect.current(call.livekitUrl ?? props.livekitUrl, call.token);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.api, props.displayName, props.agentName, props.livekitUrl]);

  // The person agreed on the consent screen before the call: give it to the server too.
  useEffect(() => {
    if (consent.needed) void consent.accept().catch(() => undefined);
  }, [consent.needed, consent]);

  const leave = async () => {
    await room.disconnect();
    props.onLeave();
  };
  const modes: { id: RoomMode; label: string }[] = [
    { id: "listening", label: "Listening" },
    { id: "direct", label: "Direct" },
  ];
  const connected = room.status === "connected";

  return (
    <Screen title={connected ? "In a call" : "Connecting…"}>
      <ErrorText error={error ?? room.error} />
      {connected && (
        <>
          <Body
            muted
          >{`${props.agentName}: ${control.present ? agentState : "not in the call"}`}</Body>
          {participants
            .filter((p) => !p.isAgent)
            .map((p) => (
              <Body
                key={p.identity}
              >{`${p.name}${p.isLocal ? " (you)" : ""}${p.isMuted ? " · muted" : ""}`}</Body>
            ))}
          <Button
            primary
            label={mute.muted ? "Unmute" : "Mute"}
            onPress={() => void mute.toggle()}
          />
          <Button
            label={control.present ? `Send ${props.agentName} out` : `Bring ${props.agentName} in`}
            onPress={() => void (control.present ? control.sendOut() : control.bringIn())}
          />
          {control.present &&
            modes.map((m) => (
              <Button
                key={m.id}
                label={`${m.label}${mode.mode === m.id ? " ✓" : ""}`}
                primary={mode.mode === m.id}
                onPress={() => void mode.set(m.id)}
              />
            ))}
          <ErrorText error={control.error} />
        </>
      )}
      <Button label="Leave" onPress={() => void leave()} />
    </Screen>
  );
}
