# Function: connectMcpInApp()

> **connectMcpInApp**(`client`, `url`, `options?`): `Promise`\<[`McpConnection`](../../web/interfaces/McpConnection.md)\>

Connect an MCP server from a mobile app: opens the server's sign-in in an in-app
sheet or the system browser, waits for the result and resolves when connected.
With an auth-session opener, dismissing the sheet cancels (after one last check).

## Parameters

### client

`Pick`\<[`OpenBlahClient`](../../web/classes/OpenBlahClient.md), `"connectMcpServer"`\>

### url

`string`

### options?

[`ConnectMcpInAppOptions`](../type-aliases/ConnectMcpInAppOptions.md) = `{}`

## Returns

`Promise`\<[`McpConnection`](../../web/interfaces/McpConnection.md)\>
