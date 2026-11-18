# Interface: StartMcpConnectionOptions

## Extended by

- [`ConnectMcpServerOptions`](ConnectMcpServerOptions.md)

## Properties

### name?

> `optional` **name?**: `string`

---

### returnUrl?

> `optional` **returnUrl?**: `string`

Where the browser goes after consent. Must be allowed in the server's settings.

---

### scope?

> `optional` **scope?**: `string`

Only the scopes you need; the server's own default when left out.

---

### userId?

> `optional` **userId?**: `string`

The person's id in your product. Leave out for the standalone app (Firebase sign-in).
