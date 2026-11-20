---
"@openblah/core": patch
"@openblah/server": patch
---

Per-room MCP server choice (`getRoomMcpServers`, `setRoomMcpServers`, `startCall({ mcpConnectionIds })`), and signed-in app users can call the invite, history, consent and agent-control routes with their Firebase ID token, as themselves only.
