# Function: createOpenBlahClient()

> **createOpenBlahClient**(`options?`): [`OpenBlahClient`](../../web/classes/OpenBlahClient.md)

Create an [OpenBlahClient](../../web/classes/OpenBlahClient.md) for React Native: same API as in `@openblah/web`,
plus the native audio session (play and record, Bluetooth, survives screen lock).

## Parameters

### options?

`Omit`\<[`OpenBlahClientOptions`](../../web/interfaces/OpenBlahClientOptions.md), `"beforeConnect"` \| `"afterDisconnect"`\> = `{}`

## Returns

[`OpenBlahClient`](../../web/classes/OpenBlahClient.md)
