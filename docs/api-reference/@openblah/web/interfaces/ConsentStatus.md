# Interface: ConsentStatus

Consent wording and version, as the server returns it. Show `text` as is.

## Extends

- [`ConsentText`](ConsentText.md)

## Properties

### agentName

> **agentName**: `string`

---

### missing

> **missing**: `object`[]

People in the room who have not consented to the current text.

#### displayName

> **displayName**: `string`

#### userId

> **userId**: `string`

---

### text

> **text**: `string`

#### Inherited from

[`ConsentText`](ConsentText.md).[`text`](ConsentText.md#text)

---

### version

> **version**: `string`

#### Inherited from

[`ConsentText`](ConsentText.md).[`version`](ConsentText.md#version)
