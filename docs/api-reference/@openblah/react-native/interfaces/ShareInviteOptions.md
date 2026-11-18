# Interface: ShareInviteOptions

## Extends

- [`CreateInviteOptions`](../../web/interfaces/CreateInviteOptions.md)

## Properties

### expiresInSeconds?

> `optional` **expiresInSeconds?**: `number`

#### Inherited from

[`CreateInviteOptions`](../../web/interfaces/CreateInviteOptions.md).[`expiresInSeconds`](../../web/interfaces/CreateInviteOptions.md#expiresinseconds)

---

### maxUses?

> `optional` **maxUses?**: `number`

#### Inherited from

[`CreateInviteOptions`](../../web/interfaces/CreateInviteOptions.md).[`maxUses`](../../web/interfaces/CreateInviteOptions.md#maxuses)

---

### message?

> `optional` **message?**: `string`

Text before the link, e.g. "Join my call". Default: "Join my call:".

---

### share?

> `optional` **share?**: [`ShareLike`](ShareLike.md)

Override the share sheet; mainly for tests.
