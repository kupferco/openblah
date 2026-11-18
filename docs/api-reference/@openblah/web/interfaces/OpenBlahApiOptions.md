# Interface: OpenBlahApiOptions

## Properties

### baseUrl

> **baseUrl**: `string`

Server base URL including `/v1`, e.g. `https://api.example.com/v1`.

---

### fetch?

> `optional` **fetch?**: \{(`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; (`input`, `init?`): `Promise`\<`Response`\>; \}

Defaults to the global `fetch`.

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`RequestInfo` \| `URL`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`RequestInfo`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

#### Call Signature

> (`input`, `init?`): `Promise`\<`Response`\>

[MDN Reference](https://developer.mozilla.org/docs/Web/API/Window/fetch)

##### Parameters

###### input

`string` \| `Request` \| `URL`

###### init?

`RequestInit`

##### Returns

`Promise`\<`Response`\>

---

### headers?

> `optional` **headers?**: () => `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

Headers for the endpoints that need the host app's credentials (everything
except joining by invite). The API key belongs to the host app's backend:
point `baseUrl` at a proxy there that adds it, or return it here only in a
trusted environment. Never ship the key in a public web bundle.

#### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>
