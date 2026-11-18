# Interface: CallRecord

One past call, in full. Only saved when the host turned "save notes" on; never audio.

## Extends

- [`CallListItem`](CallListItem.md)

## Properties

### actionLog

> **actionLog**: `object`[]

#### at

> **at**: `string`

#### text

> **text**: `string`

---

### actions

> **actions**: `object`[]

#### done

> **done**: `boolean`

#### owner?

> `optional` **owner?**: `string`

#### text

> **text**: `string`

---

### expiresAt

> **expiresAt**: `string` \| `null`

When it is deleted automatically, or null when kept until the host deletes it.

#### Inherited from

[`CallListItem`](CallListItem.md).[`expiresAt`](CallListItem.md#expiresat)

---

### hostDisplayName

> **hostDisplayName**: `string`

#### Inherited from

[`CallListItem`](CallListItem.md).[`hostDisplayName`](CallListItem.md#hostdisplayname)

---

### hostUserId

> **hostUserId**: `string`

---

### language

> **language**: `"en"` \| `"pt"`

---

### notes

> **notes**: `string`[]

---

### participants

> **participants**: `string`[]

#### Inherited from

[`CallListItem`](CallListItem.md).[`participants`](CallListItem.md#participants)

---

### retention

> **retention**: [`HistoryRetention`](../type-aliases/HistoryRetention.md)

---

### roomId

> **roomId**: `string`

#### Inherited from

[`CallListItem`](CallListItem.md).[`roomId`](CallListItem.md#roomid)

---

### savedAt

> **savedAt**: `string`

#### Inherited from

[`CallListItem`](CallListItem.md).[`savedAt`](CallListItem.md#savedat)

---

### startedAt?

> `optional` **startedAt?**: `string`

---

### summary

> **summary**: `string`

#### Inherited from

[`CallListItem`](CallListItem.md).[`summary`](CallListItem.md#summary)

---

### transcript

> **transcript**: `object`[]

#### at

> **at**: `string`

#### speaker

> **speaker**: `string`

#### text

> **text**: `string`
