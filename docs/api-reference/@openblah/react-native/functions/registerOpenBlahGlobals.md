# Function: registerOpenBlahGlobals()

> **registerOpenBlahGlobals**(): `void`

Register the WebRTC globals LiveKit needs. Call once, before anything else,
in your app's entry file (`index.js`). Safe to call more than once.

`autoConfigureAudioSession` is off: the OpenBlah client sets the Apple audio
category (`playAndRecord` with Bluetooth) and starts the audio session itself
around each call, so the choice is ours and not the library default.

## Returns

`void`
