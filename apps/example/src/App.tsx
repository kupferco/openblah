import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, TextInput, View, FlatList } from "react-native";
import {
  OpenBlahProvider,
  createOpenBlahClient,
  useAgentState,
  useMute,
  useParticipants,
  useRoom,
} from "@openblah/react-native";

const client = createOpenBlahClient();

function Call() {
  const { status, error, connect, disconnect } = useRoom();
  const participants = useParticipants();
  const agentState = useAgentState();
  const { muted, toggle } = useMute();
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
      <Text>Status: {status}</Text>
      <Text>Agent: {agentState}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <FlatList
        data={participants}
        keyExtractor={(p) => p.identity}
        renderItem={({ item }) => (
          <Text style={item.isSpeaking ? styles.speaking : undefined}>
            {item.name}
            {item.isLocal ? " (you)" : ""}
            {item.isAgent ? " (agent)" : ""}
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
  speaking: { fontWeight: "700" },
});
