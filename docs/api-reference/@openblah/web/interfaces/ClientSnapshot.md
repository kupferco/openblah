# Interface: ClientSnapshot

Everything a UI needs, as one immutable snapshot.

## Properties

### agentState

> **agentState**: [`AgentState`](../type-aliases/AgentState.md)

The agent's state, or `unavailable` when no agent is in the room.

---

### aiPaused

> **aiPaused**: `boolean`

True while the AI is paused: it listens to nobody. Show this to everyone.

---

### approvals

> **approvals**: [`ToolApproval`](ToolApproval.md)[]

Write actions waiting for confirmation. Empty unless you own the tool credentials.

---

### error

> **error**: `string` \| `null`

---

### muted

> **muted**: `boolean`

True when the local microphone is off.

---

### participants

> **participants**: [`ParticipantInfo`](ParticipantInfo.md)[]

---

### role

> **role**: [`Role`](../type-aliases/Role.md) \| `null`

Your role in the room, or null when not connected.

---

### roomId

> **roomId**: `string` \| `null`

Room id and your user id, once connected.

---

### roomMetadata

> **roomMetadata**: `string` \| `null`

The room metadata the server mirrors (agent setting, pending requests). It changes when the
agent is brought in or sent out, which is when agent controls should reload.

---

### status

> **status**: [`ConnectionStatus`](../type-aliases/ConnectionStatus.md)

---

### userId

> **userId**: `string` \| `null`
