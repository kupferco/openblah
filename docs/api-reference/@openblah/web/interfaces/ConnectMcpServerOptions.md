# Interface: ConnectMcpServerOptions

## Extends

- [`StartMcpConnectionOptions`](StartMcpConnectionOptions.md)

## Properties

### isCancelled?

> `optional` **isCancelled?**: () => `boolean`

Return true when the person closed the consent window (checked between polls).

#### Returns

`boolean`

---

### name?

> `optional` **name?**: `string`

#### Inherited from

[`StartMcpConnectionOptions`](StartMcpConnectionOptions.md).[`name`](StartMcpConnectionOptions.md#name)

---

### openAuthorization

> **openAuthorization**: (`authorizationUrl`) => `void` \| `Promise`\<`unknown`\>

Show the consent page: a popup or tab on the web, an in-app browser sheet on
mobile. Called once with the authorization URL. Credentials are typed there,
never in your UI and never by voice.

#### Parameters

##### authorizationUrl

`string`

#### Returns

`void` \| `Promise`\<`unknown`\>

---

### pollIntervalMs?

> `optional` **pollIntervalMs?**: `number`

Poll interval. Default 1500 ms.

---

### returnUrl?

> `optional` **returnUrl?**: `string`

Where the browser goes after consent. Must be allowed in the server's settings.

#### Inherited from

[`StartMcpConnectionOptions`](StartMcpConnectionOptions.md).[`returnUrl`](StartMcpConnectionOptions.md#returnurl)

---

### scope?

> `optional` **scope?**: `string`

Only the scopes you need; the server's own default when left out.

#### Inherited from

[`StartMcpConnectionOptions`](StartMcpConnectionOptions.md).[`scope`](StartMcpConnectionOptions.md#scope)

---

### signal?

> `optional` **signal?**: `AbortSignal`

---

### sleep?

> `optional` **sleep?**: (`ms`) => `Promise`\<`void`\>

Mainly for tests.

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

---

### timeoutMs?

> `optional` **timeoutMs?**: `number`

Give up after this long. Default 5 minutes.

---

### userId?

> `optional` **userId?**: `string`

The person's id in your product. Leave out for the standalone app (Firebase sign-in).

#### Inherited from

[`StartMcpConnectionOptions`](StartMcpConnectionOptions.md).[`userId`](StartMcpConnectionOptions.md#userid)
