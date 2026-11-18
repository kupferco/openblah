# Function: useHistory()

> **useHistory**(`options`): `object`

The list of past calls you were in (newest first), with `remove` for calls you host.

## Parameters

### options

[`UseHistoryOptions`](../interfaces/UseHistoryOptions.md)

## Returns

### calls

> **calls**: [`CallListItem`](../../interfaces/CallListItem.md)[]

### error

> **error**: `string` \| `null`

### loading

> **loading**: `boolean`

### refresh

> **refresh**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### remove

> **remove**: (`roomId`) => `Promise`\<`void`\>

Host only: delete everything stored for a call.

#### Parameters

##### roomId

`string`

#### Returns

`Promise`\<`void`\>
