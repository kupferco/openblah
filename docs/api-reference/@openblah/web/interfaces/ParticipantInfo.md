# Interface: ParticipantInfo

A participant in the room, reduced to what a UI needs.

## Properties

### identity

> **identity**: `string`

---

### isAgent

> **isAgent**: `boolean`

---

### isLocal

> **isLocal**: `boolean`

---

### isMuted

> **isMuted**: `boolean`

---

### isSpeaking

> **isSpeaking**: `boolean`

---

### name

> **name**: `string`

---

### role

> **role**: [`Role`](../type-aliases/Role.md)

From the token the server issued. The agent has no role and shows as `guest`; check `isAgent`.
