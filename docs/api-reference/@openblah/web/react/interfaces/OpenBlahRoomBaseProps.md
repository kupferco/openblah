# Interface: OpenBlahRoomBaseProps

Props shared by `<OpenBlahRoom />` in `@openblah/web` and `@openblah/react-native`.

## Extended by

- [`OpenBlahRoomProps`](OpenBlahRoomProps.md)
- [`OpenBlahRoomProps`](../../../react-native/interfaces/OpenBlahRoomProps.md)

## Properties

### autoJoin?

> `optional` **autoJoin?**: `boolean`

Join on mount. Default true. When false, the component shows a Join button.

---

### hide?

> `optional` **hide?**: [`OpenBlahRoomPart`](../type-aliases/OpenBlahRoomPart.md)[]

Parts to leave out. To replace a part, hide it and render your own with the hooks.

---

### labels?

> `optional` **labels?**: `Partial`\<[`OpenBlahLabels`](OpenBlahLabels.md)\>

Partial labels, merged over [defaultLabels](../variables/defaultLabels.md).

---

### onError?

> `optional` **onError?**: (`error`) => `void`

Called when joining fails.

#### Parameters

##### error

`Error`

#### Returns

`void`

---

### onLeave?

> `optional` **onLeave?**: () => `void`

Called after the user left or the room ended.

#### Returns

`void`

---

### serverUrl

> **serverUrl**: `string`

LiveKit server URL (`wss://…`) from your backend.

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](OpenBlahTheme.md)\>

Partial theme, merged over [defaultTheme](../variables/defaultTheme.md).

---

### token

> **token**: `string`

Room token from `POST /v1/tokens`. Joins as soon as both are set, unless `autoJoin` is false.
