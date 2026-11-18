# Interface: McpConnection

A saved MCP server connection. Tokens are never returned.

## Properties

### connectedAt?

> `optional` **connectedAt?**: `string`

---

### createdAt

> **createdAt**: `string`

---

### error?

> `optional` **error?**: `string`

---

### id

> **id**: `string`

---

### name

> **name**: `string`

---

### scope?

> `optional` **scope?**: `string`

---

### serverUrl

> **serverUrl**: `string`

---

### status

> **status**: `"pending"` \| `"connected"` \| `"error"`

`pending` until the person has consented in the browser.
