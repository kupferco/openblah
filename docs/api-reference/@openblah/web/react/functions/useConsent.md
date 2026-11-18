# Function: useConsent()

> **useConsent**(): `object`

Consent for a room you are already in (an app user added after the call started).
`needed` is true while the server has no consent from you for the current text.

## Returns

### accept

> **accept**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### agentName

> **agentName**: `string` \| `null`

### error

> **error**: `string` \| `null`

### needed

> **needed**: `boolean`

True when you have not accepted the current text yet.

### refresh

> **refresh**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### text

> **text**: `string` \| `null`

Consent wording to show, with `version`. Null until loaded.

### version

> **version**: `string` \| `null`
