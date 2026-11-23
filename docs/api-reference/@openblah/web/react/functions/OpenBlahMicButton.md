# Function: OpenBlahMicButton()

> **OpenBlahMicButton**(`props`): `Element`

Drop-in voice mic button. Tap to start a voice session, tap again to end it; it never starts a
second one. The session is app-wide (it lives in `<OpenBlahProvider>`), so every instance shows
the same state and it survives navigation. A halo shows listening, thinking or speaking; a
compact card confirms write actions. No transcript, no call screen.

## Parameters

### props

[`OpenBlahMicButtonProps`](../interfaces/OpenBlahMicButtonProps.md)

## Returns

`Element`
