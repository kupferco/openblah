# Function: useInviteJoin()

> **useInviteJoin**(`token`): `object`

The guest side of an invite link: loads the consent text for `token`, and
`join` connects with the consent the guest accepted.

## Parameters

### token

`string` \| `null`

## Returns

`object`

### error

> **error**: `string` \| `null`

### join

> **join**: (`displayName`, `accepted`) => `Promise`\<`void`\>

#### Parameters

##### displayName

`string`

##### accepted

`boolean`

#### Returns

`Promise`\<`void`\>

### joining

> **joining**: `boolean`

### preview

> **preview**: [`InvitePreview`](../../interfaces/InvitePreview.md) \| `null`
