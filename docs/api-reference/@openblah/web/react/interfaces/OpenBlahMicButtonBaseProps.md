# Interface: OpenBlahMicButtonBaseProps

Props shared by `<OpenBlahMicButton />` in `@openblah/web` and `@openblah/react-native`.

## Extends

- [`UseMicButtonOptions`](UseMicButtonOptions.md)

## Extended by

- [`OpenBlahMicButtonProps`](OpenBlahMicButtonProps.md)
- [`OpenBlahMicButtonProps`](../../../react-native/interfaces/OpenBlahMicButtonProps.md)

## Properties

### agentTimeoutMs?

> `optional` **agentTimeoutMs?**: `number`

How long to wait for the agent to join after the room connects, in ms. Default 20000. When it
does not join in time the session is ended, `failed` is set and the next tap tries again.

#### Inherited from

[`UseMicButtonOptions`](UseMicButtonOptions.md).[`agentTimeoutMs`](UseMicButtonOptions.md#agenttimeoutms)

---

### haloColors?

> `optional` **haloColors?**: `Partial`\<`Record`\<`"listening"` \| `"thinking"` \| `"speaking"`, `string`\>\>

Halo colours per live state. Defaults: listening = accent, thinking = warning, speaking = success green.

---

### hideConfirmation?

> `optional` **hideConfirmation?**: `boolean`

Hide the built-in compact confirmation card (answer approvals yourself with `useToolApprovals`). Default false.

---

### labels?

> `optional` **labels?**: `Partial`\<[`OpenBlahLabels`](OpenBlahLabels.md)\>

Partial labels (`micStart`, `micEnd`, `micConnecting`, `micListening`, `micThinking`, `micSpeaking`, `micFailed`, `confirmYes`, `confirmNo`).

---

### onEnd?

> `optional` **onEnd?**: () => `void`

Called after the user ended the session with a tap.

#### Returns

`void`

#### Inherited from

[`UseMicButtonOptions`](UseMicButtonOptions.md).[`onEnd`](UseMicButtonOptions.md#onend)

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

[`UseMicButtonOptions`](UseMicButtonOptions.md).[`onError`](UseMicButtonOptions.md#onerror)

---

### renderConfirmation?

> `optional` **renderConfirmation?**: (`a`) => `ReactNode`

Replace the compact confirmation card with your own.

#### Parameters

##### a

[`MicConfirmation`](MicConfirmation.md)

#### Returns

`ReactNode`

---

### size?

> `optional` **size?**: `number`

Button diameter in pixels. Default 56.

---

### start

> **start**: () => `Promise`\<[`MicSession`](MicSession.md)\>

Called on a tap when no session is running. Fetch a fresh room token from your backend.

#### Returns

`Promise`\<[`MicSession`](MicSession.md)\>

#### Inherited from

[`UseMicButtonOptions`](UseMicButtonOptions.md).[`start`](UseMicButtonOptions.md#start)

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](OpenBlahTheme.md)\>

Partial theme: `accent` and `accentText` colour the button, `danger` the live outline, `radius` is ignored (it is round).
