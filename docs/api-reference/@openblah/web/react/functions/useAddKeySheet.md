# Function: useAddKeySheet()

> **useAddKeySheet**(`options`): `object`

State of the shared add-your-own-key sheet (the standalone app uses the same one). Built on
[useOnboarding](useOnboarding.md): pick a provider (Gemini first), fill `fields`, call `submit()`.

## Parameters

### options

[`UseAddKeySheetOptions`](../interfaces/UseAddKeySheetOptions.md)

## Returns

### blocked

> **blocked**: `boolean`

A free key cannot be used in a sensitive room; show `sensitiveRefusal`.

### busy

> **busy**: `boolean` = `ob.busy`

### canSubmit

> **canSubmit**: `boolean`

### complete

> **complete**: `boolean`

### error

> **error**: `string` \| `null` = `ob.error`

### fields

> **fields**: [`KeyProviderName`](../../type-aliases/KeyProviderName.md)[]

The keys to ask for, in order (the provider's key, then speech keys).

### intro

> **intro**: `string` \| `null` = `ob.intro`

### keyUrl

> **keyUrl**: `string` \| `null` = `ob.keyUrl`

Where to get the selected provider's key.

### loading

> **loading**: `boolean` = `ob.loading`

### paidGemini

> **paidGemini**: `boolean`

Gemini only: confirm the key is a paid one (no training on the data).

### providers

> **providers**: [`OnboardingProvider`](../../interfaces/OnboardingProvider.md)[]

Gemini first, then OpenAI and Claude.

### select

> **select**: (`id`) => `void` = `ob.select`

#### Parameters

##### id

`"gemini"` \| `"openai"` \| `"claude"`

#### Returns

`void`

### selected

> **selected**: [`OnboardingProvider`](../../interfaces/OnboardingProvider.md) \| `null`

### setPaidGemini

> **setPaidGemini**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setValue

> **setValue**: (`k`, `v`) => `void`

#### Parameters

##### k

[`KeyProviderName`](../../type-aliases/KeyProviderName.md)

##### v

`string`

#### Returns

`void`

### showFreeTierWarning

> **showFreeTierWarning**: `boolean` = `isFreeGemini`

Show the free-tier warning: a free Gemini key is selected.

### submit

> **submit**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### values

> **values**: `Partial`\<`Record`\<[`KeyProviderName`](../../type-aliases/KeyProviderName.md), `string`\>\>
