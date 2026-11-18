# Function: shareInvite()

> **shareInvite**(`client`, `options?`): `Promise`\<\{ `invite`: [`Invite`](../../web/interfaces/Invite.md); `shared`: `boolean`; \}\>

Mid-call invite for React Native: the host taps Invite, a link is created and the
system share sheet opens. Resolves with the invite and whether the host actually
shared it (false when the sheet was dismissed: consider revoking the link then).

## Parameters

### client

`Pick`\<[`OpenBlahClient`](../../web/classes/OpenBlahClient.md), `"createInvite"`\>

### options?

[`ShareInviteOptions`](../interfaces/ShareInviteOptions.md) = `{}`

## Returns

`Promise`\<\{ `invite`: [`Invite`](../../web/interfaces/Invite.md); `shared`: `boolean`; \}\>
