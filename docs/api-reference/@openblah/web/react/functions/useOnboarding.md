# Function: useOnboarding()

> **useOnboarding**(`options`): `object`

First-run onboarding that you render yourself: which model provider, adding and checking
a key, starting the free trial. The server suggests the free Gemini key first (`intro`,
`providers[0]`). It needs no room, so it can run before the first call.

Flow: `select(id)`, then `addKey(...)` for each entry of `missingKeys` (or `startTrial()` for
Gemini), then `finish()` saves the choice. `ready` says the selected provider can run.

## Parameters

### options

[`UseOnboardingOptions`](../interfaces/UseOnboardingOptions.md)

## Returns

### addKey

> **addKey**: (`provider`, `key`, `opts`) => `Promise`\<`void`\>

#### Parameters

##### provider

[`KeyProviderName`](../../type-aliases/KeyProviderName.md)

##### key

`string`

##### opts?

###### noTrainingConfirmed?

`boolean`

###### tier?

`"free"` \| `"paid"`

#### Returns

`Promise`\<`void`\>

### busy

> **busy**: `boolean`

### checkKey

> **checkKey**: (`provider`, `key`) => `Promise`\<[`KeyCheckResult`](../../interfaces/KeyCheckResult.md)\>

#### Parameters

##### provider

[`KeyProviderName`](../../type-aliases/KeyProviderName.md)

##### key

`string`

#### Returns

`Promise`\<[`KeyCheckResult`](../../interfaces/KeyCheckResult.md)\>

### current

> **current**: [`ModelSettings`](../../interfaces/ModelSettings.md) \| `null`

### dataTerms

> **dataTerms**: `string` \| `null`

### error

> **error**: `string` \| `null`

### finish

> **finish**: () => `Promise`\<[`ModelSettings`](../../interfaces/ModelSettings.md)\>

#### Returns

`Promise`\<[`ModelSettings`](../../interfaces/ModelSettings.md)\>

### intro

> **intro**: `string` \| `null`

Intro copy that suggests the free Gemini key first.

### keyUrl

> **keyUrl**: `string` \| `null`

Where to get the selected provider's key, when there is a free one.

### loading

> **loading**: `boolean`

### missingKeys

> **missingKeys**: [`KeyProviderName`](../../type-aliases/KeyProviderName.md)[]

Keys still to add to use the selected provider with your own keys.

### providers

> **providers**: [`OnboardingProvider`](../../interfaces/OnboardingProvider.md)[]

### ready

> **ready**: `boolean` = `!!selected?.usable`

The selected provider can run now (own keys, product keys or the trial).

### refresh

> **refresh**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

### select

> **select**: (`id`) => `void`

#### Parameters

##### id

`"gemini"` \| `"openai"` \| `"claude"`

#### Returns

`void`

### selected

> **selected**: [`OnboardingProvider`](../../interfaces/OnboardingProvider.md) \| `null`

### startTrial

> **startTrial**: () => `Promise`\<[`TrialInfo`](../../interfaces/TrialInfo.md)\>

#### Returns

`Promise`\<[`TrialInfo`](../../interfaces/TrialInfo.md)\>

### trial

> **trial**: [`TrialInfo`](../../interfaces/TrialInfo.md) \| `null`

### trialAvailable

> **trialAvailable**: `boolean`
