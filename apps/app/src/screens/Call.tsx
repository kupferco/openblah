import { useEffect, useRef, useState } from "react";
import {
  shareInvite,
  useAgentControl,
  useAgentState,
  useConsent,
  useMute,
  useParticipants,
  useRoom,
  useRoomMode,
  type McpConnection,
  type OpenBlahClient,
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
  client: OpenBlahClient;
  displayName: string;
  agentName: string;
  /** The signed-in user's id (the host of the call). */
  userId: string;
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
  const { client } = props;
  const [error, setError] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [saveNotes, setSaveNotes] = useState(false);
  const [servers, setServers] = useState<McpConnection[]>([]);
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const [shared, setShared] = useState<string | null>(null);
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
      setRoomId(call.roomId);
      await connect.current(call.livekitUrl ?? props.livekitUrl, call.token);
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [props.api, props.displayName, props.agentName, props.livekitUrl]);

  // The person agreed on the consent screen before the call: give it to the server too.
  useEffect(() => {
    if (consent.needed) void consent.accept().catch(() => undefined);
  }, [consent.needed, consent]);

  // Host: the saved servers and which are on in this room.
  useEffect(() => {
    if (room.status !== "connected" || !control.isHost) return;
    client.listMcpServers().then(
      (l) => setServers(l.filter((x) => x.status === "connected")),
      () => undefined,
    );
    client.getRoomMcpServers().then(setEnabled, () => undefined);
  }, [room.status, control.isHost, client]);

  const attempt = (fn: () => Promise<unknown>) => () => {
    setError(null);
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const invite = attempt(async () => {
    const r = await shareInvite(client, { message: `Join my ${props.agentName} call:` });
    setShared(r.shared ? r.invite.url : null);
  });
  const toggleSaveNotes = attempt(async () => {
    if (!roomId) return;
    const r = await props.api.updateHistorySettings(roomId, props.userId, {
      saveNotes: !saveNotes,
    });
    setSaveNotes(r.saveNotes);
  });
  const toggleServer = (id: string) =>
    attempt(async () => {
      const all = servers.map((x) => x.id);
      const on = enabled ?? all;
      const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
      setEnabled(await client.setRoomMcpServers(next));
    });

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
          <Button label="Invite someone" onPress={invite} />
          {shared && <Body muted>{`Invite link shared: ${shared}`}</Body>}
          {control.isHost && (
            <>
              <Body muted>Room settings</Body>
              <Button
                label={`Save notes${saveNotes ? " ✓" : ""}`}
                primary={saveNotes}
                onPress={toggleSaveNotes}
              />
              <Button
                label={`Anyone can add ${props.agentName}${control.state?.anyoneCanAddAgent ? " ✓" : ""}`}
                primary={control.state?.anyoneCanAddAgent === true}
                onPress={attempt(() => control.setAnyoneCanAdd(!control.state?.anyoneCanAddAgent))}
              />
              {servers.length > 0 && (
                <Body muted>Tools in this room (next time the assistant joins)</Body>
              )}
              {servers.map((x) => {
                const on = enabled === null || enabled.includes(x.id);
                return (
                  <Button
                    key={x.id}
                    label={`${x.name}${on ? " ✓" : " (off)"}`}
                    primary={on}
                    onPress={toggleServer(x.id)}
                  />
                );
              })}
            </>
          )}
          <ErrorText error={control.error} />
        </>
      )}
      <Button label="Leave" onPress={() => void leave()} />
    </Screen>
  );
}
