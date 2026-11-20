# Function: useKeyStatus()

> **useKeyStatus**(`options`): `object`

The product's pre-check (`GET /v1/users/:userId/key-status`): `needs_key` means the next voice
start would ask for the user's own key, so show the banner and the sheet before they tap.
`status` is `null` while loading or when the check fails (then do nothing special).

## Parameters

### options

#### api

[`OpenBlahApi`](../../classes/OpenBlahApi.md) \| [`OpenBlahApiOptions`](../../interfaces/OpenBlahApiOptions.md)

#### userId

`string`

## Returns

`object`

### refresh

> **refresh**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### status

> **status**: [`KeyStatus`](../../interfaces/KeyStatus.md) \| `null`
