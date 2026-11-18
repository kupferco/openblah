# Type Alias: AgentState

> **AgentState** = `"listening"` \| `"thinking"` \| `"speaking"` \| `"muted"` \| `"paused"` \| `"unavailable"`

State of the agent as shown to the user. `muted` is the local user's mic state
and wins over the agent's own state, so a UI can show one indicator. `paused`
means someone paused the AI: it is not listening to anyone.
