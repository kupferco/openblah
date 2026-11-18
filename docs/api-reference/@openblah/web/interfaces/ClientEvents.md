# Interface: ClientEvents

Events emitted by [OpenBlahClient](../classes/OpenBlahClient.md).

## Properties

### change

> **change**: [`ClientSnapshot`](ClientSnapshot.md)

Fired on any change; read the new value with `getSnapshot()`.

---

### connected

> **connected**: `void`

---

### disconnected

> **disconnected**: `void`

---

### error

> **error**: `Error`

---

### inviteRequest

> **inviteRequest**: [`InviteRequestMessage`](InviteRequestMessage.md)

The agent was asked to invite someone ("Blah, invite my mother") and needs the
host app to pick the contact. Only fires for the host. Show a contact picker or
share sheet, then call `respondToInviteRequest`.
