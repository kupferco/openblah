# Class: OpenBlahApi

Typed calls to the OpenBlah server's invite, consent and host-control endpoints.

## Constructors

### Constructor

> **new OpenBlahApi**(`options`): `OpenBlahApi`

#### Parameters

##### options

[`OpenBlahApiOptions`](../interfaces/OpenBlahApiOptions.md)

#### Returns

`OpenBlahApi`

## Methods

### answerAgentRequest()

> **answerAgentRequest**(`roomId`, `requestId`, `actorUserId`, `approve`): `Promise`\<[`AgentBringInResult`](../interfaces/AgentBringInResult.md) \| \{ `agent`: `string`; `status`: `"declined"`; \}\>

#### Parameters

##### roomId

`string`

##### requestId

`string`

##### actorUserId

`string`

##### approve

`boolean`

#### Returns

`Promise`\<[`AgentBringInResult`](../interfaces/AgentBringInResult.md) \| \{ `agent`: `string`; `status`: `"declined"`; \}\>

---

### bringInAgent()

> **bringInAgent**(`roomId`, `actorUserId`): `Promise`\<[`AgentBringInResult`](../interfaces/AgentBringInResult.md)\>

Host (or anyone, if the room allows it) brings the agent in; others leave a request.

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<[`AgentBringInResult`](../interfaces/AgentBringInResult.md)\>

---

### checkKey()

> **checkKey**(`provider`, `key`, `userId?`): `Promise`\<[`KeyCheckResult`](../interfaces/KeyCheckResult.md)\>

Ask the vendor whether a key works. The key is not stored.

#### Parameters

##### provider

[`KeyProviderName`](../type-aliases/KeyProviderName.md)

##### key

`string`

##### userId?

`string`

#### Returns

`Promise`\<[`KeyCheckResult`](../interfaces/KeyCheckResult.md)\>

---

### createInvite()

> **createInvite**(`roomId`, `actorUserId`, `opts?`): `Promise`\<[`Invite`](../interfaces/Invite.md)\>

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

##### opts?

[`CreateInviteOptions`](../interfaces/CreateInviteOptions.md) = `{}`

#### Returns

`Promise`\<[`Invite`](../interfaces/Invite.md)\>

---

### deleteCall()

> **deleteCall**(`roomId`, `actorUserId`): `Promise`\<\{ `deleted`: `true`; `existed`: `boolean`; `roomId`: `string`; \}\>

Host only: remove everything stored for this call.

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<\{ `deleted`: `true`; `existed`: `boolean`; `roomId`: `string`; \}\>

---

### disconnectMcp()

> **disconnectMcp**(`id`, `userId?`): `Promise`\<`void`\>

Disconnect; the server deletes the stored tokens.

#### Parameters

##### id

`string`

##### userId?

`string`

#### Returns

`Promise`\<`void`\>

---

### endRoom()

> **endRoom**(`roomId`, `actorUserId`): `Promise`\<\{ `ended`: `true`; `id`: `string`; \}\>

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<\{ `ended`: `true`; `id`: `string`; \}\>

---

### getAgentState()

> **getAgentState**(`roomId`, `actorUserId`): `Promise`\<[`AgentControlState`](../interfaces/AgentControlState.md)\>

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<[`AgentControlState`](../interfaces/AgentControlState.md)\>

---

### getCall()

> **getCall**(`roomId`, `actorUserId`): `Promise`\<[`CallRecord`](../interfaces/CallRecord.md)\>

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<[`CallRecord`](../interfaces/CallRecord.md)\>

---

### getCallWithInvite()

> **getCallWithInvite**(`token`): `Promise`\<[`CallRecord`](../interfaces/CallRecord.md)\>

A guest reads the call they joined, read-only, through their invite token (30 days).

#### Parameters

##### token

`string`

#### Returns

`Promise`\<[`CallRecord`](../interfaces/CallRecord.md)\>

---

### getConsent()

> **getConsent**(`roomId`, `userId`): `Promise`\<[`ConsentStatus`](../interfaces/ConsentStatus.md)\>

#### Parameters

##### roomId

`string`

##### userId

`string`

#### Returns

`Promise`\<[`ConsentStatus`](../interfaces/ConsentStatus.md)\>

---

### getInvite()

> **getInvite**(`token`): `Promise`\<[`InvitePreview`](../interfaces/InvitePreview.md)\>

#### Parameters

##### token

`string`

#### Returns

`Promise`\<[`InvitePreview`](../interfaces/InvitePreview.md)\>

---

### getKeyStatus()

> **getKeyStatus**(`userId`): `Promise`\<[`KeyStatus`](../interfaces/KeyStatus.md)\>

A product's pre-check: would this user's next voice start need their own key? Call it from
your backend proxy or UI to show the banner before they tap. Product users only.

#### Parameters

##### userId

`string`

#### Returns

`Promise`\<[`KeyStatus`](../interfaces/KeyStatus.md)\>

---

### getMcpConnection()

> **getMcpConnection**(`id`, `userId?`): `Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>

#### Parameters

##### id

`string`

##### userId?

`string`

#### Returns

`Promise`\<[`McpConnection`](../interfaces/McpConnection.md)\>

---

### getOnboarding()

> **getOnboarding**(`userId?`): `Promise`\<[`OnboardingInfo`](../interfaces/OnboardingInfo.md)\>

#### Parameters

##### userId?

`string`

#### Returns

`Promise`\<[`OnboardingInfo`](../interfaces/OnboardingInfo.md)\>

---

### getRoomMcpServers()

> **getRoomMcpServers**(`roomId`, `actorUserId`): `Promise`\<`string`[] \| `null`\>

The saved servers switched on for this room; `null` means all of the host's servers.

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<`string`[] \| `null`\>

---

### getRoomSettings()

> **getRoomSettings**(`roomId`, `viewerUserId`): `Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

Room settings: the model, language and agent name for one room (host only to change).

#### Parameters

##### roomId

`string`

##### viewerUserId

`string`

#### Returns

`Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

---

### getSettings()

> **getSettings**(`userId?`): `Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

#### Parameters

##### userId?

`string`

#### Returns

`Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

---

### giveConsent()

> **giveConsent**(`roomId`, `userId`, `textVersion`): `Promise`\<\{ `consentedAt`: `string`; `roomId`: `string`; `textVersion`: `string`; `userId`: `string`; \}\>

#### Parameters

##### roomId

`string`

##### userId

`string`

##### textVersion

`string`

#### Returns

`Promise`\<\{ `consentedAt`: `string`; `roomId`: `string`; `textVersion`: `string`; `userId`: `string`; \}\>

---

### joinWithInvite()

> **joinWithInvite**(`token`, `displayName`, `consent`): `Promise`\<[`GuestJoin`](../interfaces/GuestJoin.md)\>

#### Parameters

##### token

`string`

##### displayName

`string`

##### consent

[`ConsentGrant`](../interfaces/ConsentGrant.md) \| `null`

#### Returns

`Promise`\<[`GuestJoin`](../interfaces/GuestJoin.md)\>

---

### listCalls()

> **listCalls**(`actorUserId`): `Promise`\<[`CallListItem`](../interfaces/CallListItem.md)[]\>

#### Parameters

##### actorUserId

`string`

#### Returns

`Promise`\<[`CallListItem`](../interfaces/CallListItem.md)[]\>

---

### listMcpConnections()

> **listMcpConnections**(`userId?`): `Promise`\<[`McpConnection`](../interfaces/McpConnection.md)[]\>

#### Parameters

##### userId?

`string`

#### Returns

`Promise`\<[`McpConnection`](../interfaces/McpConnection.md)[]\>

---

### listParticipants()

> **listParticipants**(`roomId`, `viewerUserId`): `Promise`\<[`RoomParticipant`](../interfaces/RoomParticipant.md)[]\>

#### Parameters

##### roomId

`string`

##### viewerUserId

`string`

#### Returns

`Promise`\<[`RoomParticipant`](../interfaces/RoomParticipant.md)[]\>

---

### removeParticipant()

> **removeParticipant**(`roomId`, `userId`, `actorUserId`): `Promise`\<\{ `removed`: `true`; `userId`: `string`; \}\>

#### Parameters

##### roomId

`string`

##### userId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<\{ `removed`: `true`; `userId`: `string`; \}\>

---

### revokeInvite()

> **revokeInvite**(`roomId`, `inviteId`, `actorUserId`): `Promise`\<\{ `id`: `string`; `revoked`: `true`; \}\>

#### Parameters

##### roomId

`string`

##### inviteId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<\{ `id`: `string`; `revoked`: `true`; \}\>

---

### saveKey()

> **saveKey**(`provider`, `key`, `opts`, `userId?`): `Promise`\<\{ `provider`: `string`; `tier`: `string`; \}\>

#### Parameters

##### provider

[`KeyProviderName`](../type-aliases/KeyProviderName.md)

##### key

`string`

##### opts

###### noTrainingConfirmed?

`boolean`

###### tier

`"free"` \| `"paid"`

##### userId?

`string`

#### Returns

`Promise`\<\{ `provider`: `string`; `tier`: `string`; \}\>

---

### sendOutAgent()

> **sendOutAgent**(`roomId`, `actorUserId`): `Promise`\<\{ `agent`: `"on"` \| `"off"` \| `"ask"`; `status`: `"off"`; \}\>

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

#### Returns

`Promise`\<\{ `agent`: `"on"` \| `"off"` \| `"ask"`; `status`: `"off"`; \}\>

---

### setRoomMcpServers()

> **setRoomMcpServers**(`roomId`, `actorUserId`, `enabledConnectionIds`): `Promise`\<`string`[] \| `null`\>

Host: choose which saved servers are on in this room (`null` = all). Next agent join.

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

##### enabledConnectionIds

`string`[] \| `null`

#### Returns

`Promise`\<`string`[] \| `null`\>

---

### startCall()

> **startCall**(`opts`): `Promise`\<[`StartedCall`](../interfaces/StartedCall.md)\>

Start a call as the signed-in user (you are the host). Returns the room and a join token.

#### Parameters

##### opts

###### agent?

`"on"` \| `"off"` \| `"ask"`

###### agentName?

`string`

###### displayName

`string`

###### mcpConnectionIds?

`string`[]

Which of the person's saved MCP servers are on in this room. Leave out for all.

#### Returns

`Promise`\<[`StartedCall`](../interfaces/StartedCall.md)\>

---

### startMcpConnection()

> **startMcpConnection**(`url`, `opts?`): `Promise`\<\{ `authorizationUrl`: `string`; `id`: `string`; \}\>

Start connecting an MCP server; open `authorizationUrl` for the person to consent.

#### Parameters

##### url

`string`

##### opts?

[`StartMcpConnectionOptions`](../interfaces/StartMcpConnectionOptions.md) = `{}`

#### Returns

`Promise`\<\{ `authorizationUrl`: `string`; `id`: `string`; \}\>

---

### startTrial()

> **startTrial**(`userId?`): `Promise`\<\{ `started`: `true`; `status`: [`TrialInfo`](../interfaces/TrialInfo.md); \}\>

#### Parameters

##### userId?

`string`

#### Returns

`Promise`\<\{ `started`: `true`; `status`: [`TrialInfo`](../interfaces/TrialInfo.md); \}\>

---

### testMcpConnection()

> **testMcpConnection**(`id`, `userId?`): `Promise`\<\{ `message`: `string`; `ok`: `boolean`; \}\>

#### Parameters

##### id

`string`

##### userId?

`string`

#### Returns

`Promise`\<\{ `message`: `string`; `ok`: `boolean`; \}\>

---

### updateAgentSettings()

> **updateAgentSettings**(`roomId`, `actorUserId`, `settings`): `Promise`\<`unknown`\>

Host: "anyone can add the agent" and the idle timeout (`null` goes back to the default).

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

##### settings

###### anyoneCanAddAgent?

`boolean`

###### idleTimeoutSeconds?

`number` \| `null`

#### Returns

`Promise`\<`unknown`\>

---

### updateHistorySettings()

> **updateHistorySettings**(`roomId`, `actorUserId`, `settings`): `Promise`\<\{ `retention`: [`HistoryRetention`](../type-aliases/HistoryRetention.md); `saveNotes`: `boolean`; \}\>

Host only: turn saving notes on or off, and choose how long history is kept.

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

##### settings

###### retention?

[`HistoryRetention`](../type-aliases/HistoryRetention.md)

###### saveNotes?

`boolean`

#### Returns

`Promise`\<\{ `retention`: [`HistoryRetention`](../type-aliases/HistoryRetention.md); `saveNotes`: `boolean`; \}\>

---

### updateRoomSettings()

> **updateRoomSettings**(`roomId`, `actorUserId`, `settings`): `Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

#### Parameters

##### roomId

`string`

##### actorUserId

`string`

##### settings

###### agentName?

`string`

###### language?

`"en"` \| `"pt"` \| `"auto"`

###### llm?

`"gemini"` \| `"openai"` \| `"claude"` \| \{ `model?`: `string`; `provider`: `string`; \} \| `null`

#### Returns

`Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

---

### updateSettings()

> **updateSettings**(`settings`, `userId?`): `Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

Change your model or language setting. `llm: null` goes back to the default.

#### Parameters

##### settings

###### language?

`"en"` \| `"pt"` \| `"auto"`

###### llm?

`"gemini"` \| `"openai"` \| `"claude"` \| \{ `model?`: `string`; `provider`: `string`; \} \| `null`

##### userId?

`string`

#### Returns

`Promise`\<[`ModelSettings`](../interfaces/ModelSettings.md)\>

---

### warmup()

> **warmup**(): `Promise`\<`"warming"` \| `"warm"` \| `"unavailable"` \| `"limited"`\>

Ask the server to wake the agent worker for the signed-in user. Never throws.

#### Returns

`Promise`\<`"warming"` \| `"warm"` \| `"unavailable"` \| `"limited"`\>
