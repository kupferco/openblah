# Class: OpenBlahClient

Vanilla JS client for one OpenBlah voice room. Framework-free; the React hooks wrap it.

## Remarks

0.x: the API may change between minor versions.

## Constructors

### Constructor

> **new OpenBlahClient**(`options?`): `OpenBlahClient`

#### Parameters

##### options?

[`OpenBlahClientOptions`](../interfaces/OpenBlahClientOptions.md) = `{}`

#### Returns

`OpenBlahClient`

## Methods

### answerAgentRequest()

> **answerAgentRequest**(`requestId`, `approve`): `Promise`\<`void`\>

Host: approve or decline a request to bring the agent in.

#### Parameters

##### requestId

`string`

##### approve

`boolean`

#### Returns

`Promise`\<`void`\>

---

### bringInAgent()

> **bringInAgent**(): `Promise`\<[`AgentBringInResult`](../interfaces/AgentBringInResult.md)\>

Bring the agent in. The host (or anyone, when the room allows it) turns it on: everyone is then
asked for consent again and the agent listens only when all have agreed. Anyone else sends a
request the host approves.

#### Returns

`Promise`\<[`AgentBringInResult`](../interfaces/AgentBringInResult.md)\>

---

### connect()

> **connect**(`serverUrl`, `token`): `Promise`\<`void`\>

Join a room and publish the microphone.

#### Parameters

##### serverUrl

`string`

LiveKit WebSocket URL (`wss://...`), as returned with the token by the OpenBlah server.

##### token

`string`

Join token from `POST /v1/tokens`.

#### Returns

`Promise`\<`void`\>

---

### connectMcpServer()

> **connectMcpServer**(`url`, `options`): `Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>

Connect one of the person's MCP servers: runs the OAuth sign-in through
`openAuthorization` and resolves once it is connected. Works before or during a call.
Voice never carries credentials.

#### Parameters

##### url

`string`

##### options

[`ConnectMcpServerOptions`](../interfaces/ConnectMcpServerOptions.md)

#### Returns

`Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>

---

### createInvite()

> **createInvite**(`options?`): `Promise`\<[`Invite`](../interfaces/Invite.md)\>

Host: create an invite link for this room (for example to copy or share).

#### Parameters

##### options?

[`CreateInviteOptions`](../interfaces/CreateInviteOptions.md)

#### Returns

`Promise`\<[`Invite`](../interfaces/Invite.md)\>

---

### disconnect()

> **disconnect**(): `Promise`\<`void`\>

Leave the room. Safe to call when not connected.

#### Returns

`Promise`\<`void`\>

---

### disconnectMcpServer()

> **disconnectMcpServer**(`id`, `userId?`): `Promise`\<`void`\>

Disconnect a server; its stored tokens are deleted.

#### Parameters

##### id

`string`

##### userId?

`string`

#### Returns

`Promise`\<`void`\>

---

### endRoom()

> **endRoom**(): `Promise`\<`void`\>

Host: end the room for everyone.

#### Returns

`Promise`\<`void`\>

---

### getAgentState()

> **getAgentState**(): `Promise`\<[`AgentControlState`](../interfaces/AgentControlState.md)\>

The room's agent setting, pending requests and who still has to consent.

#### Returns

`Promise`\<[`AgentControlState`](../interfaces/AgentControlState.md)\>

---

### getConsent()

> **getConsent**(): `Promise`\<[`ConsentStatus`](../interfaces/ConsentStatus.md)\>

The consent text for this room and who has not consented yet.

#### Returns

`Promise`\<[`ConsentStatus`](../interfaces/ConsentStatus.md)\>

---

### getInvitePreview()

> **getInvitePreview**(`token`): `Promise`\<[`InvitePreview`](../interfaces/InvitePreview.md)\>

What a guest should see before joining: host name, agent name and the consent text.

#### Parameters

##### token

`string`

#### Returns

`Promise`\<[`InvitePreview`](../interfaces/InvitePreview.md)\>

---

### getRoomMcpServers()

> **getRoomMcpServers**(): `Promise`\<`string`[] \| `null`\>

Which saved MCP servers are on in this room (`null` = all).

#### Returns

`Promise`\<`string`[] \| `null`\>

---

### getSnapshot()

> **getSnapshot**(): [`ClientSnapshot`](../interfaces/ClientSnapshot.md)

Current state. The object is replaced (never mutated) on every change.

#### Returns

[`ClientSnapshot`](../interfaces/ClientSnapshot.md)

---

### giveConsent()

> **giveConsent**(`version`): `Promise`\<`void`\>

Record that you accept the consent text (`version` from [getConsent](#getconsent)).

#### Parameters

##### version

`string`

#### Returns

`Promise`\<`void`\>

---

### joinWithInvite()

> **joinWithInvite**(`token`, `displayName`, `consent`): `Promise`\<`void`\>

Join a room from an invite link as a guest and connect. `consent` is what the
guest agreed to: show them [getInvitePreview](#getinvitepreview)'s `consent.text` first and pass
its `version` as `textVersion`. Pass `null` only when the room's AI is off (the server
refuses otherwise). Rejects with `OpenBlahApiError` (404 for any
invalid, expired or used-up invite).

#### Parameters

##### token

`string`

##### displayName

`string`

##### consent

[`ConsentGrant`](../interfaces/ConsentGrant.md) \| `null`

#### Returns

`Promise`\<`void`\>

---

### listMcpServers()

> **listMcpServers**(`userId?`): `Promise`\<[`McpConnection`](../interfaces/McpConnection.md)[]\>

#### Parameters

##### userId?

`string`

#### Returns

`Promise`\<[`McpConnection`](../interfaces/McpConnection.md)[]\>

---

### listParticipants()

> **listParticipants**(): `Promise`\<[`RoomParticipant`](../interfaces/RoomParticipant.md)[]\>

Everyone in the room per the server (guests do not see contact details).

#### Returns

`Promise`\<[`RoomParticipant`](../interfaces/RoomParticipant.md)[]\>

---

### on()

> **on**\<`K`\>(`event`, `listener`): () => `void`

Subscribe to an event. Returns an unsubscribe function.

#### Type Parameters

##### K

`K` _extends_ keyof [`ClientEvents`](../interfaces/ClientEvents.md)

#### Parameters

##### event

`K`

##### listener

`Listener`\<[`ClientEvents`](../interfaces/ClientEvents.md)\[`K`\]\>

#### Returns

() => `void`

---

### removeParticipant()

> **removeParticipant**(`userId`): `Promise`\<`void`\>

Host: remove someone from the room.

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<`void`\>

---

### respondToApproval()

> **respondToApproval**(`id`, `approve`): `Promise`\<`void`\>

Confirm (`approve: true`) or cancel a pending write action. Only the owner
of the tool credentials is accepted; the agent checks who sent it.

#### Parameters

##### id

`string`

##### approve

`boolean`

#### Returns

`Promise`\<`void`\>

---

### respondToInviteRequest()

> **respondToInviteRequest**(`requestId`, `status`): `Promise`\<`void`\>

Host: tell the agent what happened to an `inviteRequest` ("sent" once a link was shared).

#### Parameters

##### requestId

`string`

##### status

`"sent"` \| `"declined"`

#### Returns

`Promise`\<`void`\>

---

### revokeInvite()

> **revokeInvite**(`inviteId`): `Promise`\<`void`\>

Host: make an invite link stop working.

#### Parameters

##### inviteId

`string`

#### Returns

`Promise`\<`void`\>

---

### sendOutAgent()

> **sendOutAgent**(): `Promise`\<`void`\>

Send the agent out: it leaves and nothing is listened to. Host, or anyone if the room allows.

#### Returns

`Promise`\<`void`\>

---

### setAiPaused()

> **setAiPaused**(`paused`): `Promise`\<`void`\>

Pause or resume the AI for everyone. While paused the agent listens to nobody and
`aiPaused` is true in every client. Anyone can pause; only the host or the person
who paused can resume. Resolves when the request is sent; the state changes when
the agent confirms it.

#### Parameters

##### paused

`boolean`

#### Returns

`Promise`\<`void`\>

---

### setMode()

> **setMode**(`mode`): `Promise`\<`void`\>

Switch the agent's mode. Direct is host only (the agent ignores it from anyone else).

#### Parameters

##### mode

[`RoomMode`](../type-aliases/RoomMode.md)

#### Returns

`Promise`\<`void`\>

---

### setMuted()

> **setMuted**(`muted`): `Promise`\<`void`\>

Turn the microphone on or off.

#### Parameters

##### muted

`boolean`

#### Returns

`Promise`\<`void`\>

---

### setRoomMcpServers()

> **setRoomMcpServers**(`ids`): `Promise`\<`string`[] \| `null`\>

Host: choose which saved MCP servers are on in this room. Applies when the agent next joins.

#### Parameters

##### ids

`string`[] \| `null`

#### Returns

`Promise`\<`string`[] \| `null`\>

---

### startOnce()

> **startOnce**(`getJoin`): `Promise`\<`boolean`\>

Start a session unless one is running or already starting (also while `getJoin` is still
fetching a token). Returns false when ignored. Used by the mic button, so two taps or two
buttons never open two sessions.

#### Parameters

##### getJoin

() => `Promise`\<\{ `serverUrl`: `string`; `token`: `string`; \}\>

#### Returns

`Promise`\<`boolean`\>

---

### testMcpServer()

> **testMcpServer**(`id`, `userId?`): `Promise`\<\{ `message`: `string`; `ok`: `boolean`; \}\>

#### Parameters

##### id

`string`

##### userId?

`string`

#### Returns

`Promise`\<\{ `message`: `string`; `ok`: `boolean`; \}\>

---

### toggleMute()

> **toggleMute**(): `Promise`\<`boolean`\>

Flip the microphone. Returns the new muted value.

#### Returns

`Promise`\<`boolean`\>

---

### updateAgentSettings()

> **updateAgentSettings**(`settings`): `Promise`\<`void`\>

Host: "anyone can add the agent" and the idle timeout in seconds.

#### Parameters

##### settings

###### anyoneCanAddAgent?

`boolean`

###### idleTimeoutSeconds?

`number` \| `null`

#### Returns

`Promise`\<`void`\>
