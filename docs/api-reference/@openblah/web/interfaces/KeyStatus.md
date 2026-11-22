# Interface: KeyStatus

Result of [OpenBlahApi.getKeyStatus](../classes/OpenBlahApi.md#getkeystatus).

## Properties

### reason?

> `optional` **reason?**: [`KeyRequiredReason`](../type-aliases/KeyRequiredReason.md)

---

### status

> **status**: `"ok"` \| `"needs_key"`

`needs_key`: this user's next voice start will ask for their own key.
