# Interface: AgentBringInResult

What happened to a request to bring the agent in: it is `on`, `awaiting_consent` (asking
everyone again), `requested` (the host was asked) or `refused` (a cap, key or trial limit).

## Properties

### agent

> **agent**: `"on"` \| `"off"` \| `"ask"`

---

### error?

> `optional` **error?**: `string`

---

### missing?

> `optional` **missing?**: `object`[]

#### displayName

> **displayName**: `string`

#### userId

> **userId**: `string`

---

### status

> **status**: `"on"` \| `"awaiting_consent"` \| `"requested"` \| `"refused"`
