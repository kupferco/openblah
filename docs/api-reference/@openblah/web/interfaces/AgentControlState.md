# Interface: AgentControlState

The room's agent setting and what is pending. `agent` is `off` (a plain call), `on`, or `ask`
(off until someone invites it).

## Properties

### agent

> **agent**: `"on"` \| `"off"` \| `"ask"`

---

### agentName

> **agentName**: `string`

---

### anyoneCanAddAgent

> **anyoneCanAddAgent**: `boolean`

Any participant may bring the agent in or send it out, not only the host.

---

### awaitingConsent

> **awaitingConsent**: `boolean`

The agent is on but waits for everyone to consent; it listens to nobody until then.

---

### canControl

> **canControl**: `boolean`

True when you may bring the agent in and send it out without asking.

---

### idleTimeoutSeconds

> **idleTimeoutSeconds**: `number`

The agent leaves after this many seconds of silence.

---

### missing

> **missing**: `object`[]

Who has not consented yet (only while awaiting consent).

#### displayName

> **displayName**: `string`

#### userId

> **userId**: `string`

---

### requests

> **requests**: [`AgentRequestInfo`](AgentRequestInfo.md)[]

Pending requests; only the host sees them.
