# Function: useToolApprovals()

> **useToolApprovals**(): `object`

Write actions the agent is waiting on (book, send, pay). Show `pending` as a
confirmation card; `approve` / `decline` answer it. Only the owner of the
tool credentials sees requests, and only their answer is accepted. They can
also just say yes out loud.

## Returns

`object`

### approve

> **approve**: (`id`) => `Promise`\<`void`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

### decline

> **decline**: (`id`) => `Promise`\<`void`\>

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`void`\>

### pending

> **pending**: [`ToolApproval`](../../interfaces/ToolApproval.md)[] = `s.approvals`
