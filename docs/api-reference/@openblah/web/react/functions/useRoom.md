# Function: useRoom()

> **useRoom**(): `object`

Connection state plus `connect` / `disconnect`.

## Returns

`object`

### connect

> **connect**: (`serverUrl`, `token`) => `Promise`\<`void`\>

#### Parameters

##### serverUrl

`string`

##### token

`string`

#### Returns

`Promise`\<`void`\>

### disconnect

> **disconnect**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### error

> **error**: `string` \| `null` = `s.error`

### status

> **status**: [`ConnectionStatus`](../../type-aliases/ConnectionStatus.md) = `s.status`
