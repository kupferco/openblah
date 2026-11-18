# Function: connectMcpServer()

> **connectMcpServer**(`api`, `url`, `options`): `Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>

Connect an MCP server for a person: start the OAuth flow, show the consent
page, then wait for the result. Resolves with the connected server; rejects
with [McpConnectError](../classes/McpConnectError.md) when the person refused, closed the window, or it
timed out. A cancelled or timed-out attempt is removed again.

## Parameters

### api

`Pick`\<[`OpenBlahApi`](../classes/OpenBlahApi.md), `"startMcpConnection"` \| `"getMcpConnection"` \| `"disconnectMcp"`\>

### url

`string`

### options

[`ConnectMcpServerOptions`](../interfaces/ConnectMcpServerOptions.md)

## Returns

`Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>
