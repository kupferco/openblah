# Function: copyInviteLink()

> **copyInviteLink**(`client`, `options?`): `Promise`\<[`Invite`](../interfaces/Invite.md)\>

Mid-call invite for the web: the host taps Invite, a link is created and copied.
Returns the invite so the UI can show the link ("Link copied") and offer to revoke it.
Falls back to showing the link when the clipboard is not available (rejects with the
invite attached as `error.invite`).

## Parameters

### client

`Pick`\<[`OpenBlahClient`](../classes/OpenBlahClient.md), `"createInvite"`\>

### options?

[`CreateInviteOptions`](../interfaces/CreateInviteOptions.md) & `object`

## Returns

`Promise`\<[`Invite`](../interfaces/Invite.md)\>
