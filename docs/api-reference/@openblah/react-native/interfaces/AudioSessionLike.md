# Interface: AudioSessionLike

The part of `AudioSession` from `@livekit/react-native` that is used here.

## Methods

### configureAudio()

> **configureAudio**(`config`): `Promise`\<`void`\>

#### Parameters

##### config

###### android?

\{ `audioTypeOptions`: `unknown`; `preferredOutputList?`: `string`[]; \}

###### android.audioTypeOptions

`unknown`

###### android.preferredOutputList?

`string`[]

###### ios?

\{ `defaultOutput?`: `"speaker"` \| `"earpiece"`; \}

###### ios.defaultOutput?

`"speaker"` \| `"earpiece"`

#### Returns

`Promise`\<`void`\>

---

### setAppleAudioConfiguration()

> **setAppleAudioConfiguration**(`config`): `Promise`\<`void`\>

#### Parameters

##### config

###### audioCategory?

`string`

###### audioCategoryOptions?

`string`[]

###### audioMode?

`string`

#### Returns

`Promise`\<`void`\>

---

### startAudioSession()

> **startAudioSession**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

---

### stopAudioSession()

> **stopAudioSession**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>
