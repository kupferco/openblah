# Function: useHostControls()

> **useHostControls**(): `object`

Host controls: invite links, removing people and ending the room. Everything
is rejected by the server unless you are the host; `isHost` lets a UI hide the buttons.

## Returns

`object`

### createInvite

> **createInvite**: (`options?`) => `Promise`\<[`Invite`](../../interfaces/Invite.md)\>

#### Parameters

##### options?

[`CreateInviteOptions`](../../interfaces/CreateInviteOptions.md)

#### Returns

`Promise`\<[`Invite`](../../interfaces/Invite.md)\>

### endRoom

> **endRoom**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### isHost

> **isHost**: `boolean`

### removeParticipant

> **removeParticipant**: (`userId`) => `Promise`\<`void`\>

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<`void`\>

### revokeInvite

> **revokeInvite**: (`inviteId`) => `Promise`\<`void`\>

#### Parameters

##### inviteId

`string`

#### Returns

`Promise`\<`void`\>
