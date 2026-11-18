# Function: connectMcpInBrowser()

> **connectMcpInBrowser**(`client`, `url`, `options?`): `Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>

Connect an MCP server from a web page. Call it straight from a click: the
consent popup is opened before the first network call so browsers allow it. The
popup shows the server's own sign-in page; closing it cancels. Resolves when connected.

## Parameters

### client

`Pick`\<[`OpenBlahClient`](../classes/OpenBlahClient.md), `"connectMcpServer"`\>

### url

`string`

### options?

[`ConnectMcpInBrowserOptions`](../type-aliases/ConnectMcpInBrowserOptions.md) = `{}`

## Returns

`Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>
