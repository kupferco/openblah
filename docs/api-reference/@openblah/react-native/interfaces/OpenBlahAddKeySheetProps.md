# Interface: OpenBlahAddKeySheetProps

Props of the React Native `<OpenBlahAddKeySheet />`. Same as the web component.

## Extends

- [`UseAddKeySheetOptions`](../../web/react/interfaces/UseAddKeySheetOptions.md)

## Properties

### api

> **api**: [`OpenBlahApi`](../../web/classes/OpenBlahApi.md) \| [`OpenBlahApiOptions`](../../web/interfaces/OpenBlahApiOptions.md)

#### Inherited from

[`UseAddKeySheetOptions`](../../web/react/interfaces/UseAddKeySheetOptions.md).[`api`](../../web/react/interfaces/UseAddKeySheetOptions.md#api)

---

### onDone?

> `optional` **onDone?**: () => `void`

Called after the keys were saved.

#### Returns

`void`

#### Inherited from

[`UseAddKeySheetOptions`](../../web/react/interfaces/UseAddKeySheetOptions.md).[`onDone`](../../web/react/interfaces/UseAddKeySheetOptions.md#ondone)

---

### sensitive?

> `optional` **sensitive?**: `boolean`

The room is sensitive: a free key is refused.

#### Inherited from

[`UseAddKeySheetOptions`](../../web/react/interfaces/UseAddKeySheetOptions.md).[`sensitive`](../../web/react/interfaces/UseAddKeySheetOptions.md#sensitive)

---

### style?

> `optional` **style?**: `StyleProp`\<`ViewStyle`\>

---

### texts?

> `optional` **texts?**: `Partial`\<[`KeySheetTexts`](../../web/react/interfaces/KeySheetTexts.md)\>

Partial texts, merged over the English ones.

---

### theme?

> `optional` **theme?**: `Partial`\<[`OpenBlahTheme`](../../web/react/interfaces/OpenBlahTheme.md)\>

---

### userId?

> `optional` **userId?**: `string`

The product's user id; omit it in the standalone app (same sheet, same hook).

#### Inherited from

[`UseAddKeySheetOptions`](../../web/react/interfaces/UseAddKeySheetOptions.md).[`userId`](../../web/react/interfaces/UseAddKeySheetOptions.md#userid)
