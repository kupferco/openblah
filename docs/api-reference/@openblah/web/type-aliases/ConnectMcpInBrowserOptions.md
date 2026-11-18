# Type Alias: ConnectMcpInBrowserOptions

> **ConnectMcpInBrowserOptions** = `Omit`\<[`ConnectMcpServerOptions`](../interfaces/ConnectMcpServerOptions.md), `"openAuthorization"` \| `"isCancelled"`\> & `object`

## Type Declaration

### open?

> `optional` **open?**: _typeof_ `window.open`

Override `window.open`; mainly for tests.
