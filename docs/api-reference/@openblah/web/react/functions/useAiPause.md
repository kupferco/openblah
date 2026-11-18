# Function: useAiPause()

> **useAiPause**(): `object`

Pause the AI for everyone. `paused` is true while nobody is being listened to:
show it prominently (for example a banner "AI paused"), the agent says so too.

## Returns

`object`

### paused

> **paused**: `boolean` = `s.aiPaused`

### setPaused

> **setPaused**: (`p`) => `Promise`\<`void`\>

#### Parameters

##### p

`boolean`

#### Returns

`Promise`\<`void`\>

### toggle

> **toggle**: () => `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
