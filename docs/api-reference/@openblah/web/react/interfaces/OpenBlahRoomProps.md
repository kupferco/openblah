# Interface: OpenBlahRoomProps

Props of the web `<OpenBlahRoom />`.

## Extends

- [`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md)

## Properties

### autoJoin?

> `optional` **autoJoin?**: `boolean`

Join on mount. Default true. When false, the component shows a Join button.

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`autoJoin`](OpenBlahRoomBaseProps.md#autojoin)

---

### children?

> `optional` **children?**: `ReactNode`

Extra content shown under the controls, for example your own transcript.

---

### className?

> `optional` **className?**: `string`

---

### hide?

> `optional` **hide?**: [`OpenBlahRoomPart`](../type-aliases/OpenBlahRoomPart.md)[]

Parts to leave out. To replace a part, hide it and render your own with the hooks.

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`hide`](OpenBlahRoomBaseProps.md#hide)

---

### labels?

> `optional` **labels?**: `Partial`\<[`OpenBlahLabels`](OpenBlahLabels.md)\>

Partial labels, merged over [defaultLabels](../variables/defaultLabels.md).

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`labels`](OpenBlahRoomBaseProps.md#labels)

---

### onError?

> `optional` **onError?**: (`error`) => `void`

Called when joining fails.

#### Parameters

##### error

`Error`

#### Returns

`void`

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`onError`](OpenBlahRoomBaseProps.md#onerror)

---

### onLeave?

> `optional` **onLeave?**: () => `void`

Called after the user left or the room ended.

#### Returns

`void`

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`onLeave`](OpenBlahRoomBaseProps.md#onleave)

---

### serverUrl

> **serverUrl**: `string`

LiveKit server URL (`wss://…`) from your backend.

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`serverUrl`](OpenBlahRoomBaseProps.md#serverurl)

---

### style?

> `optional` **style?**: `CSSProperties`

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](OpenBlahTheme.md)\>

Partial theme, merged over [defaultTheme](../variables/defaultTheme.md).

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`theme`](OpenBlahRoomBaseProps.md#theme)

---

### token

> **token**: `string`

Room token from `POST /v1/tokens`. Joins as soon as both are set, unless `autoJoin` is false.

#### Inherited from

[`OpenBlahRoomBaseProps`](OpenBlahRoomBaseProps.md).[`token`](OpenBlahRoomBaseProps.md#token)
