# @openblah/core

## 0.2.2

### Patch Changes

- The mic button shows a connecting spinner until the agent is ready to talk.

## 0.2.1

### Patch Changes

- Web: play the agent's voice. The client now attaches remote audio tracks to a hidden `<audio>` element (browsers play nothing otherwise), calls `room.startAudio()` after connecting, and adds `audioBlocked` to the snapshot plus `client.startAudio()` for a "tap to hear" button when the browser blocks autoplay. New `audioContainer` option; no change on React Native.

## 0.2.0

### Minor Changes

- 5fef567: Add the drop-in `<OpenBlahMicButton />` (voice only, one app-wide session) and the `useMicButton` hook.

### Patch Changes

- fead249: Per-room MCP server choice (`getRoomMcpServers`, `setRoomMcpServers`, `startCall({ mcpConnectionIds })`), and signed-in app users can call the invite, history, consent and agent-control routes with their Firebase ID token, as themselves only.
