---
"@openblah/core": minor
"@openblah/web": minor
"@openblah/react-native": minor
---

The mic button is now the loader: the mic fades into a spinner until the agent has joined and is ready to listen. If the agent does not join in time (`agentTimeoutMs`, default 20 s) the session ends, `failed` is set, a plain message (`micFailed` label) shows and a tap tries again. New `agentReady` in the client snapshot and `useAgentReady()`.
