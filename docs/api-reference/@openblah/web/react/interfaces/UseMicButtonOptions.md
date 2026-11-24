# Interface: UseMicButtonOptions

Options of [useMicButton](../functions/useMicButton.md) and the `<OpenBlahMicButton />` components.

## Extended by

- [`OpenBlahMicButtonBaseProps`](OpenBlahMicButtonBaseProps.md)

## Properties

### agentTimeoutMs?

> `optional` **agentTimeoutMs?**: `number`

How long to wait for the agent to join after the room connects, in ms. Default 20000. When it
does not join in time the session is ended, `failed` is set and the next tap tries again.

---

### onEnd?

> `optional` **onEnd?**: () => `void`

Called after the user ended the session with a tap.

#### Returns

`void`

---

### onError?

> `optional` **onError?**: (`error`) => `void`

Called when starting fails (including a `KeyRequiredError`).

#### Parameters

##### error

`Error`

#### Returns

`void`

---

### start

> **start**: () => `Promise`\<[`MicSession`](MicSession.md)\>

Called on a tap when no session is running. Fetch a fresh room token from your backend.

#### Returns

`Promise`\<[`MicSession`](MicSession.md)\>
