# Interface: OpenBlahAddKeySheetProps

Props of the web `<OpenBlahAddKeySheet />`.

## Extends

- [`UseAddKeySheetOptions`](UseAddKeySheetOptions.md)

## Properties

### api

> **api**: [`OpenBlahApi`](../../classes/OpenBlahApi.md) \| [`OpenBlahApiOptions`](../../interfaces/OpenBlahApiOptions.md)

#### Inherited from

[`UseAddKeySheetOptions`](UseAddKeySheetOptions.md).[`api`](UseAddKeySheetOptions.md#api)

---

### className?

> `optional` **className?**: `string`

---

### onDone?

> `optional` **onDone?**: () => `void`

Called after the keys were saved.

#### Returns

`void`

#### Inherited from

[`UseAddKeySheetOptions`](UseAddKeySheetOptions.md).[`onDone`](UseAddKeySheetOptions.md#ondone)

---

### sensitive?

> `optional` **sensitive?**: `boolean`

The room is sensitive: a free key is refused.

#### Inherited from

[`UseAddKeySheetOptions`](UseAddKeySheetOptions.md).[`sensitive`](UseAddKeySheetOptions.md#sensitive)

---

### style?

> `optional` **style?**: `CSSProperties`

---

### texts?

> `optional` **texts?**: `Partial`\<[`KeySheetTexts`](KeySheetTexts.md)\>

Partial texts, merged over the English ones.

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](OpenBlahTheme.md)\>

---

### userId?

> `optional` **userId?**: `string`

The product's user id; omit it in the standalone app (same sheet, same hook).

#### Inherited from

[`UseAddKeySheetOptions`](UseAddKeySheetOptions.md).[`userId`](UseAddKeySheetOptions.md#userid)
