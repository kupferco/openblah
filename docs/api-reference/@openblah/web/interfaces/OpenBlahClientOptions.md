# Interface: OpenBlahClientOptions

Options for [OpenBlahClient](../classes/OpenBlahClient.md).

## Properties

### afterDisconnect?

> `optional` **afterDisconnect?**: () => `Promise`\<`void`\>

Runs after the room is left, on disconnect or a failed connect. Errors are ignored.

#### Returns

`Promise`\<`void`\>

---

### api?

> `optional` **api?**: [`OpenBlahApi`](../classes/OpenBlahApi.md) \| [`OpenBlahApiOptions`](OpenBlahApiOptions.md)

The OpenBlah server, for invites, consent and host controls. Pass options, or a
ready [OpenBlahApi](../classes/OpenBlahApi.md). Without it those methods throw.

---

### audioContainer?

> `optional` **audioContainer?**: \{ `appendChild`(`el`): `unknown`; \} \| `null`

Where the `<audio>` elements for other participants (the agent) go. A browser only plays a
remote track once it is attached to a media element, so the client does it. Defaults to
`document.body` when there is a DOM; `null` turns it off (you attach tracks yourself). On
React Native there is no DOM and LiveKit plays remote audio natively.

---

### beforeConnect?

> `optional` **beforeConnect?**: () => `Promise`\<`void`\>

Runs before the room connects (e.g. start the native audio session on React Native).
If it throws, the connection is not attempted.

#### Returns

`Promise`\<`void`\>

---

### createRoom?

> `optional` **createRoom?**: () => `RoomLike`

Create the LiveKit room. Defaults to `new Room()`; mainly for tests.

#### Returns

`RoomLike`

---

### livekitUrl?

> `optional` **livekitUrl?**: `string`

LiveKit URL to use when joining by invite and the server does not return one.
