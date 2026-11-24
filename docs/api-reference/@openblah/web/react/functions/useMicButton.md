# Function: useMicButton()

> **useMicButton**(`options`): `object`

State and the tap handler behind the mic button, for building your own. The session lives on
the client in `<OpenBlahProvider>`, so it survives navigation and every instance shows the same state.

## Parameters

### options

[`UseMicButtonOptions`](../interfaces/UseMicButtonOptions.md)

## Returns

### active

> **active**: `boolean`

True while a session runs or is starting: a tap now ends it (or is ignored while starting).

### approvals

> **approvals**: `object`

#### approvals.approve

> **approve**: (`id`) => `Promise`\<`void`\>

##### Parameters

###### id

`string`

##### Returns

`Promise`\<`void`\>

#### approvals.decline

> **decline**: (`id`) => `Promise`\<`void`\>

##### Parameters

###### id

`string`

##### Returns

`Promise`\<`void`\>

#### approvals.pending

> **pending**: [`ToolApproval`](../../interfaces/ToolApproval.md)[] = `s.approvals`

### error

> **error**: `string` \| `null` = `room.error`

### failed

> **failed**: `boolean`

True after starting failed or the agent did not join in time; a tap tries again.

### state

> **state**: [`MicButtonState`](../type-aliases/MicButtonState.md)

### toggle

> **toggle**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
