# Interface: UseAddKeySheetOptions

## Extended by

- [`OpenBlahAddKeySheetProps`](OpenBlahAddKeySheetProps.md)
- [`OpenBlahAddKeySheetProps`](../../../react-native/interfaces/OpenBlahAddKeySheetProps.md)

## Properties

### api

> **api**: [`OpenBlahApi`](../../classes/OpenBlahApi.md) \| [`OpenBlahApiOptions`](../../interfaces/OpenBlahApiOptions.md)

---

### onDone?

> `optional` **onDone?**: () => `void`

Called after the keys were saved.

#### Returns

`void`

---

### sensitive?

> `optional` **sensitive?**: `boolean`

The room is sensitive: a free key is refused.

---

### userId?

> `optional` **userId?**: `string`

The product's user id; omit it in the standalone app (same sheet, same hook).
