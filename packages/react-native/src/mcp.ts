import { Linking } from "react-native";
import type { ConnectMcpServerOptions, McpConnection, OpenBlahClient } from "@openblah/core";

export type ConnectMcpInAppOptions = Omit<
  ConnectMcpServerOptions,
  "openAuthorization" | "isCancelled"
> & {
  /**
   * Show the consent page. Pass `(url) => WebBrowser.openAuthSessionAsync(url)` from
   * `expo-web-browser` for an in-app sheet that also reports when it is dismissed.
   * Default: open the system browser with `Linking.openURL`.
   */
  openAuthSession?: (url: string) => Promise<{ type?: string } | unknown>;
};

/**
 * Connect an MCP server from a mobile app: opens the server's sign-in in an in-app
 * sheet or the system browser, waits for the result and resolves when connected.
 * With an auth-session opener, dismissing the sheet cancels (after one last check).
 */
export async function connectMcpInApp(
  client: Pick<OpenBlahClient, "connectMcpServer">,
  url: string,
  options: ConnectMcpInAppOptions = {},
): Promise<McpConnection> {
  const { openAuthSession, ...rest } = options;
  let dismissed = false;
  return client.connectMcpServer(url, {
    ...rest,
    openAuthorization: (authorizationUrl) => {
      if (!openAuthSession) return Linking.openURL(authorizationUrl);
      // Do not wait for the sheet: the poll sees the server-side result.
      void Promise.resolve(openAuthSession(authorizationUrl)).then((r) => {
        const type = (r as { type?: string } | undefined)?.type;
        if (type === "cancel" || type === "dismiss") dismissed = true;
      });
    },
    isCancelled: () => dismissed,
  });
}
