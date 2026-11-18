import type { ConnectMcpServerOptions, McpConnection, OpenBlahClient } from "@openblah/core";

export type ConnectMcpInBrowserOptions = Omit<
  ConnectMcpServerOptions,
  "openAuthorization" | "isCancelled"
> & {
  /** Override `window.open`; mainly for tests. */
  open?: typeof window.open;
};

/**
 * Connect an MCP server from a web page. Call it straight from a click: the
 * consent popup is opened before the first network call so browsers allow it. The
 * popup shows the server's own sign-in page; closing it cancels. Resolves when connected.
 */
export async function connectMcpInBrowser(
  client: Pick<OpenBlahClient, "connectMcpServer">,
  url: string,
  options: ConnectMcpInBrowserOptions = {},
): Promise<McpConnection> {
  const { open = globalThis.window?.open?.bind(globalThis.window), ...rest } = options;
  if (!open) throw new Error("No window to open the sign-in in");
  const popup = open("about:blank", "openblah-mcp-connect", "popup,width=520,height=720");
  if (!popup) throw new Error("The sign-in window was blocked. Allow popups and try again.");
  try {
    return await client.connectMcpServer(url, {
      ...rest,
      openAuthorization: (authorizationUrl) => {
        popup.location.href = authorizationUrl;
      },
      isCancelled: () => popup.closed,
    });
  } finally {
    if (!popup.closed) popup.close();
  }
}
