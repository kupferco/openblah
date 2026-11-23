# Interface: OpenBlahMicButtonProps

Props of the React Native `<OpenBlahMicButton />`.

## Extends

- [`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md)

## Properties

### haloColors?

> `optional` **haloColors?**: `Partial`\<`Record`\<`"listening"` \| `"thinking"` \| `"speaking"`, `string`\>\>

Halo colours per live state. Defaults: listening = accent, thinking = warning, speaking = success green.

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`haloColors`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#halocolors)

---

### hideConfirmation?

> `optional` **hideConfirmation?**: `boolean`

Hide the built-in compact confirmation card (answer approvals yourself with `useToolApprovals`). Default false.

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`hideConfirmation`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#hideconfirmation)

---

### labels?

> `optional` **labels?**: `Partial`\<[`OpenBlahLabels`](../../web/react/interfaces/OpenBlahLabels.md)\>

Partial labels (`micStart`, `micEnd`, `micConnecting`, `micListening`, `micThinking`, `micSpeaking`, `confirmYes`, `confirmNo`).

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`labels`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#labels)

---

### onEnd?

> `optional` **onEnd?**: () => `void`

Called after the user ended the session with a tap.

#### Returns

`void`

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`onEnd`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#onend)

---

### onError?

> `optional` **onError?**: (`error`) => `void`

Called when starting fails (including a `KeyRequiredError`).

#### Parameters

##### error

`Error`

#### Returns

`void`

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`onError`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#onerror)

---

### renderConfirmation?

> `optional` **renderConfirmation?**: (`a`) => `ReactNode`

Replace the compact confirmation card with your own.

#### Parameters

##### a

[`MicConfirmation`](../../web/react/interfaces/MicConfirmation.md)

#### Returns

`ReactNode`

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`renderConfirmation`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#renderconfirmation)

---

### size?

> `optional` **size?**: `number`

Button diameter in pixels. Default 56.

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`size`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#size)

---

### start

> **start**: () => `Promise`\<[`MicSession`](../../web/react/interfaces/MicSession.md)\>

Called on a tap when no session is running. Fetch a fresh room token from your backend.

#### Returns

`Promise`\<[`MicSession`](../../web/react/interfaces/MicSession.md)\>

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`start`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#start)

---

### style?

> `optional` **style?**: `StyleProp`\<`ViewStyle`\>

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](../../web/react/interfaces/OpenBlahTheme.md)\>

Partial theme: `accent` and `accentText` colour the button, `danger` the live outline, `radius` is ignored (it is round).

#### Inherited from

[`OpenBlahMicButtonBaseProps`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md).[`theme`](../../web/react/interfaces/OpenBlahMicButtonBaseProps.md#theme)
