import { useState } from "react";
import {
  Alert,
  Button,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  FlatList,
} from "react-native";
import {
  OpenBlahProvider,
  createOpenBlahClient,
  shareInvite,
  useAgentState,
  useAiPause,
  useHostControls,
  useInviteRequests,
  useMute,
  useParticipants,
  useRole,
  useRoom,
} from "@openblah/react-native";

// Point `api` at your backend's proxy for the OpenBlah server: the API key must not ship in the app.
const client = createOpenBlahClient({
  api: { baseUrl: process.env.EXPO_PUBLIC_OPENBLAH_API ?? "http://localhost:8080/v1" },
});

function Call() {
  const { status, error, connect, disconnect } = useRoom();
  const participants = useParticipants();
  const agentState = useAgentState();
  const { muted, toggle } = useMute();
  const pause = useAiPause();
  const host = useHostControls();
  const role = useRole();
  // "Blah, invite my mother": the agent asks; the host picks who and shares the link.
  useInviteRequests(async (req) => {
    const { shared } = await shareInvite(host, { message: `Join my call (${req.who}):` });
    return shared ? "sent" : "declined";
  });
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const connected = status === "connected";

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.title}>OpenBlah example</Text>
      <TextInput
        style={styles.input}
        placeholder="LiveKit URL (wss://...)"
        autoCapitalize="none"
        autoCorrect={false}
        value={url}
        onChangeText={setUrl}
      />
      <TextInput
        style={styles.input}
        placeholder="Token from POST /v1/tokens"
        autoCapitalize="none"
        autoCorrect={false}
        value={token}
        onChangeText={setToken}
      />
      <View style={styles.row}>
        <Button
          title={connected ? "Leave" : "Join"}
          disabled={status === "connecting" || (!connected && (!url || !token))}
          onPress={() =>
            void (connected ? disconnect() : connect(url.trim(), token.trim()).catch(() => {}))
          }
        />
        <Button
          title={muted ? "Unmute" : "Mute"}
          disabled={!connected}
          onPress={() => void toggle()}
        />
      </View>
      {pause.paused ? (
        <Text style={styles.banner}>AI paused: nobody is being listened to.</Text>
      ) : null}
      <View style={styles.row}>
        <Button
          title={pause.paused ? "Resume AI" : "Pause AI"}
          disabled={!connected}
          onPress={() => void pause.toggle()}
        />
        {host.isHost ? (
          <Button
            title="Invite"
            disabled={!connected}
            onPress={() =>
              shareInvite(host).catch((e: Error) => Alert.alert("Invite failed", e.message))
            }
          />
        ) : null}
      </View>
      <Text>
        Status: {status} {role ? `(${role})` : ""}
      </Text>
      <Text>Agent: {agentState}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={participants}
        keyExtractor={(p) => p.identity}
        renderItem={({ item }) => (
          <Text style={item.isSpeaking ? styles.speaking : undefined}>
            {item.name}
            {item.isLocal ? " (you)" : ""}
            {item.isAgent ? " (agent)" : ` [${item.role}]`}
            {item.isMuted ? " muted" : ""}
          </Text>
        )}
      />
    </SafeAreaView>
  );
}

/** Joins a room with a token and shows participants, agent state and a mute button. */
export default function App() {
  return (
    <OpenBlahProvider client={client}>
      <Call />
    </OpenBlahProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 8, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 8 },
  row: { flexDirection: "row", gap: 16 },
  error: { color: "#b00020" },
  banner: { backgroundColor: "#fde68a", padding: 8, fontWeight: "600" },
  speaking: { fontWeight: "700" },
});
