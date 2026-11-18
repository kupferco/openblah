# Function: useCall()

> **useCall**(`options`): `object`

One past call: transcript, notes, actions, summary and action log. `null` until loaded.

## Parameters

### options

[`UseCallOptions`](../type-aliases/UseCallOptions.md)

## Returns

### call

> **call**: [`CallRecord`](../../interfaces/CallRecord.md) \| `null`

### error

> **error**: `string` \| `null`

### loading

> **loading**: `boolean`

### remove

> **remove**: () => `Promise`\<`void`\>

Host only: delete this call's history.

#### Returns

`Promise`\<`void`\>

### setSettings

> **setSettings**: (`settings`) => `Promise`\<\{ `retention`: [`HistoryRetention`](../../type-aliases/HistoryRetention.md); `saveNotes`: `boolean`; \}\>

Host only: save notes on/off and retention for this room.

#### Parameters

##### settings

###### retention?

[`HistoryRetention`](../../type-aliases/HistoryRetention.md)

###### saveNotes?

`boolean`

#### Returns

`Promise`\<\{ `retention`: [`HistoryRetention`](../../type-aliases/HistoryRetention.md); `saveNotes`: `boolean`; \}\>
