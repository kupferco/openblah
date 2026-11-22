import { useCallback, useEffect, useState } from "react";
import { connectMcpInApp, type McpConnection, type OpenBlahClient } from "@openblah/react-native";
import { Body, Button, ErrorText, Field, Screen } from "../ui.js";

/**
 * Tools: the person's MCP servers. Add one by URL (full OAuth sign-in in an in-app browser
 * sheet, never typed here), then test or disconnect it. Which ones are on in a call is chosen
 * on the call screen.
 */
export function ServersScreen(props: {
  client: OpenBlahClient;
  /** Show the consent page; `WebBrowser.openAuthSessionAsync` on the device. */
  openAuthSession?: (url: string) => Promise<unknown>;
  returnUrl?: string;
  onBack: () => void;
}) {
  const { client } = props;
  const [servers, setServers] = useState<McpConnection[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setServers(await client.listMcpServers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      await connectMcpInApp(client, url.trim(), {
        ...(props.openAuthSession ? { openAuthSession: props.openAuthSession } : {}),
        ...(props.returnUrl ? { returnUrl: props.returnUrl } : {}),
      });
      setUrl("");
      await refresh();
    });

  const test = (s: McpConnection) =>
    run(async () => {
      const r = await client.testMcpServer(s.id);
      setResults((x) => ({ ...x, [s.id]: r.ok ? `Works: ${r.message}` : `Failed: ${r.message}` }));
    });

  const disconnect = (s: McpConnection) =>
    run(async () => {
      await client.disconnectMcpServer(s.id);
      await refresh();
    });

  return (
    <Screen title="Tools">
      <Body muted>
        Connect an MCP server so the assistant can use it by voice. You sign in on the server's own
        page; nothing secret is typed or spoken here.
      </Body>
      {servers.length === 0 && <Body muted>No servers yet.</Body>}
      {servers.map((s) => (
        <Body key={s.id}>
          {`${s.name} · ${s.serverUrl} · ${s.status}${s.error ? ` (${s.error})` : ""}`}
        </Body>
      ))}
      {servers.map((s) => (
        <Body key={`${s.id}-r`} muted>
          {results[s.id] ?? ""}
        </Body>
      ))}
      {servers.map((s) => (
        <Button
          key={`${s.id}-t`}
          label={`Test ${s.name}`}
          disabled={busy}
          onPress={() => void test(s)}
        />
      ))}
      {servers.map((s) => (
        <Button
          key={`${s.id}-d`}
          label={`Disconnect ${s.name}`}
          disabled={busy}
          onPress={() => void disconnect(s)}
        />
      ))}
      <Field label="Server URL" value={url} onChangeText={setUrl} keyboard="default" />
      <ErrorText error={error} />
      <Button
        primary
        label="Connect server"
        disabled={busy || url.trim() === ""}
        onPress={() => void connect()}
      />
      <Button label="Back" onPress={props.onBack} />
    </Screen>
  );
}
