# Function: useAgentControl()

> **useAgentControl**(): `object`

The optional agent: bring it in, send it out, ask for it, approve a request. Each room has the
agent `off` (a plain call), `on` or `ask` (off until someone invites it).

- `present` is true while the agent is in the call; `state.agent` is the setting.
- `bringIn()` / `request()` call the same endpoint: the host (or anyone, when `state.anyoneCanAddAgent`)
  turns it on and everyone is asked for consent again (`useConsent`); anyone else sends a request,
  which shows up for the host in `requests`.
- `approve(id)` / `decline(id)` are host only. `sendOut()` makes the agent leave.
- While `state.awaitingConsent` is true the agent listens to nobody: show who is `missing`.

## Returns

### approve

> **approve**: (`requestId`) => `Promise`\<`void`\>

#### Parameters

##### requestId

`string`

#### Returns

`Promise`\<`void`\>

### bringIn

> **bringIn**: () => `Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\>

#### Returns

`Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\>

### decline

> **decline**: (`requestId`) => `Promise`\<`void`\>

#### Parameters

##### requestId

`string`

#### Returns

`Promise`\<`void`\>

### error

> **error**: `string` \| `null`

### isHost

> **isHost**: `boolean`

### present

> **present**: `boolean`

The agent is in the call right now.

### refresh

> **refresh**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### request

> **request**: () => `Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\> = `bringIn`

Same as `bringIn`: for a non-host it sends a request the host approves.

#### Returns

`Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\>

### requests

> **requests**: [`AgentRequestInfo`](../../interfaces/AgentRequestInfo.md)[]

Pending requests (host only).

### sendOut

> **sendOut**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### setAnyoneCanAdd

> **setAnyoneCanAdd**: (`anyone`) => `Promise`\<`void`\>

Host: let any participant bring the agent in and send it out.

#### Parameters

##### anyone

`boolean`

#### Returns

`Promise`\<`void`\>

### setIdleTimeoutSeconds

> **setIdleTimeoutSeconds**: (`seconds`) => `Promise`\<`void`\>

Host: the agent leaves after this many seconds of silence.

#### Parameters

##### seconds

`number` \| `null`

#### Returns

`Promise`\<`void`\>

### state

> **state**: [`AgentControlState`](../../interfaces/AgentControlState.md) \| `null`
