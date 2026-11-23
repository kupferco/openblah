# Interface: OpenBlahMicButtonProps

Props of the web `<OpenBlahMicButton />`.

## Extends

- [`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md)

## Properties

### className?

> `optional` **className?**: `string`

---

### haloColors?

> `optional` **haloColors?**: `Partial`\<`Record`\<`"listening"` \| `"thinking"` \| `"speaking"`, `string`\>\>

Halo colours per live state. Defaults: listening = accent, thinking = warning, speaking = success green.

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`haloColors`](OpenBlahMicButtonBaseProps.md#halocolors)

---

### hideConfirmation?

> `optional` **hideConfirmation?**: `boolean`

Hide the built-in compact confirmation card (answer approvals yourself with `useToolApprovals`). Default false.

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`hideConfirmation`](OpenBlahMicButtonBaseProps.md#hideconfirmation)

---

### labels?

> `optional` **labels?**: `Partial`\<[`OpenBlahLabels`](OpenBlahLabels.md)\>

Partial labels (`micStart`, `micEnd`, `micConnecting`, `micListening`, `micThinking`, `micSpeaking`, `confirmYes`, `confirmNo`).

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`labels`](OpenBlahMicButtonBaseProps.md#labels)

---

### onEnd?

> `optional` **onEnd?**: () => `void`

Called after the user ended the session with a tap.

#### Returns

`void`

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`onEnd`](OpenBlahMicButtonBaseProps.md#onend)

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

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`onError`](OpenBlahMicButtonBaseProps.md#onerror)

---

### renderConfirmation?

> `optional` **renderConfirmation?**: (`a`) => `ReactNode`

Replace the compact confirmation card with your own.

#### Parameters

##### a

[`MicConfirmation`](MicConfirmation.md)

#### Returns

`ReactNode`

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`renderConfirmation`](OpenBlahMicButtonBaseProps.md#renderconfirmation)

---

### size?

> `optional` **size?**: `number`

Button diameter in pixels. Default 56.

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`size`](OpenBlahMicButtonBaseProps.md#size)

---

### start

> **start**: () => `Promise`\<[`MicSession`](MicSession.md)\>

Called on a tap when no session is running. Fetch a fresh room token from your backend.

#### Returns

`Promise`\<[`MicSession`](MicSession.md)\>

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`start`](OpenBlahMicButtonBaseProps.md#start)

---

### style?

> `optional` **style?**: `CSSProperties`

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](OpenBlahTheme.md)\>

Partial theme: `accent` and `accentText` colour the button, `danger` the live outline, `radius` is ignored (it is round).

#### Inherited from

[`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md).[`theme`](OpenBlahMicButtonBaseProps.md#theme)
