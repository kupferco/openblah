# Interface: ToolApproval

A write action the agent is waiting to run until its owner confirms.

## Properties

### expiresAt

> **expiresAt**: `string`

ISO time after which it lapses.

---

### id

> **id**: `string`

---

### ownerId

> **ownerId**: `string`

Participant who owns the credentials. Only they can confirm.

---

### summary

> **summary**: `string`

What the agent will do, with the details. Show this to the person.

---

### tool

> **tool**: `string`

Short label of what will run, e.g. "book table".
