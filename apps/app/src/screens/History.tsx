import { useState } from "react";
import {
  useCall,
  useHistory,
  type HistoryRetention,
  type OpenBlahApi,
} from "@openblah/react-native";
import { Body, Button, ErrorText, Screen } from "../ui.js";

const RETENTION: { id: HistoryRetention; label: string }[] = [
  { id: "30d", label: "30 days" },
  { id: "1y", label: "1 year" },
  { id: "forever", label: "Until I delete it" },
];

/** Past calls (newest first). Tap one to read it. */
export function HistoryScreen(props: { api: OpenBlahApi; userId: string; onBack: () => void }) {
  const history = useHistory({ api: props.api, userId: props.userId });
  const [open, setOpen] = useState<string | null>(null);
  if (open) {
    return (
      <CallDetail
        api={props.api}
        userId={props.userId}
        roomId={open}
        onBack={() => {
          setOpen(null);
          void history.refresh();
        }}
      />
    );
  }
  return (
    <Screen title="Call history">
      <ErrorText error={history.error} />
      {!history.loading && history.calls.length === 0 && (
        <Body muted>No saved calls yet. Turn on "Save notes" in a call to keep its summary.</Body>
      )}
      {history.calls.map((c) => (
        <Button
          key={c.roomId}
          label={`${new Date(c.savedAt).toDateString()} · ${c.participants.join(", ")}`}
          onPress={() => setOpen(c.roomId)}
        />
      ))}
      <Button label="Back" onPress={props.onBack} />
    </Screen>
  );
}

/** One call: summary, notes, actions and transcript. The host can set retention or delete it. */
function CallDetail(props: {
  api: OpenBlahApi;
  userId: string;
  roomId: string;
  onBack: () => void;
}) {
  const { call, loading, error, remove, setSettings } = useCall({
    api: props.api,
    userId: props.userId,
    roomId: props.roomId,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const isHost = call?.hostUserId === props.userId;
  const guard = (fn: () => Promise<unknown>) => () => {
    setActionError(null);
    fn().catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <Screen title="Call">
      <ErrorText error={error ?? actionError} />
      {loading && <Body muted>Loading…</Body>}
      {!loading && !call && !error && <Body muted>This call was deleted.</Body>}
      {call && (
        <>
          <Body muted>{`With ${call.participants.join(", ")}`}</Body>
          <Body>{call.summary || "No summary."}</Body>
          {call.notes.length > 0 && <Body muted>Notes</Body>}
          {call.notes.map((n, i) => (
            <Body key={`n${i}`}>{`• ${n}`}</Body>
          ))}
          {call.actions.length > 0 && <Body muted>Actions</Body>}
          {call.actions.map((a, i) => (
            <Body
              key={`a${i}`}
            >{`${a.done ? "✓" : "○"} ${a.text}${a.owner ? ` (${a.owner})` : ""}`}</Body>
          ))}
          <Body muted>Transcript</Body>
          {call.transcript.map((t, i) => (
            <Body key={`t${i}`}>{`${t.speaker}: ${t.text}`}</Body>
          ))}
          <Body muted>
            {call.expiresAt
              ? `Deleted automatically on ${new Date(call.expiresAt).toDateString()}.`
              : "Kept until the host deletes it."}
          </Body>
          {isHost && (
            <>
              <Body muted>Keep this call for</Body>
              {RETENTION.map((r) => (
                <Button
                  key={r.id}
                  label={`${r.label}${call.retention === r.id ? " ✓" : ""}`}
                  primary={call.retention === r.id}
                  onPress={guard(() => setSettings({ retention: r.id }))}
                />
              ))}
              <Button
                label="Delete this call"
                onPress={guard(async () => {
                  await remove();
                })}
              />
            </>
          )}
        </>
      )}
      <Button label="Back" onPress={props.onBack} />
    </Screen>
  );
}
