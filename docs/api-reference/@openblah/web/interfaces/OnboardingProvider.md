# Interface: OnboardingProvider

A model provider in the onboarding list. Show `copy`; the Gemini entry is `recommended`.

## Properties

### copy

> **copy**: `string`

---

### hasKey

> **hasKey**: `boolean`

You saved a key for this provider.

---

### id

> **id**: `"gemini"` \| `"openai"` \| `"claude"`

---

### keyMode?

> `optional` **keyMode?**: `"server"` \| `"byok"` \| `"product"` \| `"trial"`

---

### keyUrl?

> `optional` **keyUrl?**: `string`

Where to get a (free) key.

---

### label

> **label**: `string`

---

### missingKeys

> **missingKeys**: [`KeyProviderName`](../type-aliases/KeyProviderName.md)[]

Keys still missing to use this provider with your own keys (speech keys are needed too).

---

### recommended

> **recommended**: `boolean`

---

### usable

> **usable**: `boolean`

It can run now (own keys, the product's keys or the trial).
