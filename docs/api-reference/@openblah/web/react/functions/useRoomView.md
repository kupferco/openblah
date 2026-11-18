# Function: useRoomView()

> **useRoomView**(`props`): `object`

Everything `<OpenBlahRoom />` shows, from the public hooks. The web and React Native components
both render from this, and you can too if you want your own layout.

## Parameters

### props

#### autoJoin?

`boolean`

#### onError?

(`error`) => `void`

#### onLeave?

() => `void`

#### serverUrl

`string`

#### token

`string`

## Returns

`object`

### agentState

> **agentState**: [`AgentState`](../../type-aliases/AgentState.md)

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

### connected

> **connected**: `boolean`

### consent

> **consent**: `object`

#### consent.accept

> **accept**: () => `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

#### consent.agentName

> **agentName**: `string` \| `null`

#### consent.error

> **error**: `string` \| `null`

#### consent.needed

> **needed**: `boolean`

True when you have not accepted the current text yet.

#### consent.refresh

> **refresh**: () => `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

#### consent.text

> **text**: `string` \| `null`

Consent wording to show, with `version`. Null until loaded.

#### consent.version

> **version**: `string` \| `null`

### control

> **control**: `object`

#### control.approve

> **approve**: (`requestId`) => `Promise`\<`void`\>

##### Parameters

###### requestId

`string`

##### Returns

`Promise`\<`void`\>

#### control.bringIn

> **bringIn**: () => `Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\>

##### Returns

`Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\>

#### control.decline

> **decline**: (`requestId`) => `Promise`\<`void`\>

##### Parameters

###### requestId

`string`

##### Returns

`Promise`\<`void`\>

#### control.error

> **error**: `string` \| `null`

#### control.isHost

> **isHost**: `boolean`

#### control.present

> **present**: `boolean`

The agent is in the call right now.

#### control.refresh

> **refresh**: () => `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

#### control.request

> **request**: () => `Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\> = `bringIn`

Same as `bringIn`: for a non-host it sends a request the host approves.

##### Returns

`Promise`\<[`AgentBringInResult`](../../interfaces/AgentBringInResult.md)\>

#### control.requests

> **requests**: [`AgentRequestInfo`](../../interfaces/AgentRequestInfo.md)[]

Pending requests (host only).

#### control.sendOut

> **sendOut**: () => `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

#### control.setAnyoneCanAdd

> **setAnyoneCanAdd**: (`anyone`) => `Promise`\<`void`\>

Host: let any participant bring the agent in and send it out.

##### Parameters

###### anyone

`boolean`

##### Returns

`Promise`\<`void`\>

#### control.setIdleTimeoutSeconds

> **setIdleTimeoutSeconds**: (`seconds`) => `Promise`\<`void`\>

Host: the agent leaves after this many seconds of silence.

##### Parameters

###### seconds

`number` \| `null`

##### Returns

`Promise`\<`void`\>

#### control.state

> **state**: [`AgentControlState`](../../interfaces/AgentControlState.md) \| `null`

### error

> **error**: `string` \| `null` = `room.error`

### host

> **host**: `object`

#### host.createInvite

> **createInvite**: (`options?`) => `Promise`\<[`Invite`](../../interfaces/Invite.md)\>

##### Parameters

###### options?

[`CreateInviteOptions`](../../interfaces/CreateInviteOptions.md)

##### Returns

`Promise`\<[`Invite`](../../interfaces/Invite.md)\>

#### host.endRoom

> **endRoom**: () => `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

#### host.isHost

> **isHost**: `boolean`

#### host.removeParticipant

> **removeParticipant**: (`userId`) => `Promise`\<`void`\>

##### Parameters

###### userId

`string`

##### Returns

`Promise`\<`void`\>

#### host.revokeInvite

> **revokeInvite**: (`inviteId`) => `Promise`\<`void`\>

##### Parameters

###### inviteId

`string`

##### Returns

`Promise`\<`void`\>

### join

> **join**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### joining

> **joining**: `boolean`

### leave

> **leave**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### mute

> **mute**: `object`

#### mute.muted

> **muted**: `boolean` = `s.muted`

#### mute.setMuted

> **setMuted**: (`m`) => `Promise`\<`void`\>

##### Parameters

###### m

`boolean`

##### Returns

`Promise`\<`void`\>

#### mute.toggle

> **toggle**: () => `Promise`\<`boolean`\>

##### Returns

`Promise`\<`boolean`\>

### participants

> **participants**: [`ParticipantInfo`](../../interfaces/ParticipantInfo.md)[]

### pause

> **pause**: `object`

#### pause.paused

> **paused**: `boolean` = `s.aiPaused`

#### pause.setPaused

> **setPaused**: (`p`) => `Promise`\<`void`\>

##### Parameters

###### p

`boolean`

##### Returns

`Promise`\<`void`\>

#### pause.toggle

> **toggle**: () => `Promise`\<`void`\>

##### Returns

`Promise`\<`void`\>

### role

> **role**: [`Role`](../../type-aliases/Role.md) \| `null`

### status

> **status**: [`ConnectionStatus`](../../type-aliases/ConnectionStatus.md) = `room.status`
