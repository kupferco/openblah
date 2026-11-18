import { useState } from "react";
import { Button, SafeAreaView, StyleSheet, Text, TextInput } from "react-native";
import {
  OpenBlahProvider,
  OpenBlahRoom,
  createOpenBlahClient,
  shareInvite,
  useHostControls,
  useInviteRequests,
} from "@openblah/react-native";

// Point `api` at your backend's proxy for the OpenBlah server: the API key must not ship in the app.
const client = createOpenBlahClient({
  api: { baseUrl: process.env.EXPO_PUBLIC_OPENBLAH_API ?? "http://localhost:8080/v1" },
});

/** "Blah, invite my mother": the agent asks; the host picks who and shares the link. */
function InviteRequests() {
  const host = useHostControls();
  useInviteRequests(async (req) => {
    const { shared } = await shareInvite(host, { message: `Join my call (${req.who}):` });
    return shared ? "sent" : "declined";
  });
  return null;
}

/** Joins a room with a token using the ready component and public API only. */
export default function App() {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [joined, setJoined] = useState(false);
  return (
    <OpenBlahProvider client={client}>
      <SafeAreaView style={styles.screen}>
        <Text style={styles.title}>OpenBlah example</Text>
        {joined ? (
          <>
            <InviteRequests />
            <OpenBlahRoom
              serverUrl={url.trim()}
              token={token.trim()}
              onLeave={() => setJoined(false)}
            />
          </>
        ) : (
          <>
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
            <Button
              title="Open the room"
              disabled={!url || !token}
              onPress={() => setJoined(true)}
            />
          </>
        )}
      </SafeAreaView>
    </OpenBlahProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 8, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 8 },
});
