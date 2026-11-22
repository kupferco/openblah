# Interface: OpenBlahRoomProps

Props of the React Native `<OpenBlahRoom />`. Same as the web component, with `style` for a View.

## Extends

- [`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md)

## Properties

### autoJoin?

> `optional` **autoJoin?**: `boolean`

Join on mount. Default true. When false, the component shows a Join button.

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`autoJoin`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#autojoin)

---

### children?

> `optional` **children?**: `ReactNode`

Extra content shown under the controls, for example your own transcript.

---

### hide?

> `optional` **hide?**: [`OpenBlahRoomPart`](../../web/react/type-aliases/OpenBlahRoomPart.md)[]

Parts to leave out. To replace a part, hide it and render your own with the hooks.

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`hide`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#hide)

---

### keyRequired?

> `optional` **keyRequired?**: \{ `reason?`: `"product_not_paying"` \| `"trial_used"`; \} \| `null`

Set when the product does not pay for this user's voice (a `KeyRequiredError` from starting
the call, or `useKeyStatus` saying `needs_key`). The room then shows "Add your own key to
keep using voice" with a button, instead of an error.

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`keyRequired`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#keyrequired)

---

### labels?

> `optional` **labels?**: `Partial`\<[`OpenBlahLabels`](../../web/react/interfaces/OpenBlahLabels.md)\>

Partial labels, merged over [defaultLabels](../../web/react/variables/defaultLabels.md).

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`labels`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#labels)

---

### onAddKey?

> `optional` **onAddKey?**: () => `void`

The user tapped "Add your key": open your add-key sheet (`<OpenBlahAddKeySheet />`).

#### Returns

`void`

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`onAddKey`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#onaddkey)

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

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`onError`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#onerror)

---

### onLeave?

> `optional` **onLeave?**: () => `void`

Called after the user left or the room ended.

#### Returns

`void`

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`onLeave`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#onleave)

---

### serverUrl

> **serverUrl**: `string`

LiveKit server URL (`wss://…`) from your backend.

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`serverUrl`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#serverurl)

---

### style?

> `optional` **style?**: `StyleProp`\<`ViewStyle`\>

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](../../web/react/interfaces/OpenBlahTheme.md)\>

Partial theme, merged over [defaultTheme](../../web/react/variables/defaultTheme.md).

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`theme`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#theme)

---

### token

> **token**: `string`

Room token from `POST /v1/tokens`. Joins as soon as both are set, unless `autoJoin` is false.

#### Inherited from

[`OpenBlahRoomBaseProps`](../../web/react/interfaces/OpenBlahRoomBaseProps.md).[`token`](../../web/react/interfaces/OpenBlahRoomBaseProps.md#token)
