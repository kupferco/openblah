# @openblah/core

## 0.2.0

### Minor Changes

- 5fef567: Add the drop-in `<OpenBlahMicButton />` (voice only, one app-wide session) and the `useMicButton` hook.

### Patch Changes

- fead249: Per-room MCP server choice (`getRoomMcpServers`, `setRoomMcpServers`, `startCall({ mcpConnectionIds })`), and signed-in app users can call the invite, history, consent and agent-control routes with their Firebase ID token, as themselves only.
