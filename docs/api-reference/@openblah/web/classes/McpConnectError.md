# Class: McpConnectError

Why connecting did not finish.

## Extends

- `Error`

## Constructors

### Constructor

> **new McpConnectError**(`reason`, `message`, `connectionId?`): `McpConnectError`

#### Parameters

##### reason

`"refused"` \| `"cancelled"` \| `"timeout"`

##### message

`string`

##### connectionId?

`string`

#### Returns

`McpConnectError`

#### Overrides

`Error.constructor`

## Properties

### connectionId?

> `readonly` `optional` **connectionId?**: `string`

---

### reason

> `readonly` **reason**: `"refused"` \| `"cancelled"` \| `"timeout"`
