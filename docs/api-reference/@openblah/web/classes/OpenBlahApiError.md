# Class: OpenBlahApiError

Error from the server: `status` is the HTTP status, `message` the server's `error` text.

## Extends

- `Error`

## Constructors

### Constructor

> **new OpenBlahApiError**(`status`, `message`, `body`): `OpenBlahApiError`

#### Parameters

##### status

`number`

##### message

`string`

##### body

`unknown`

#### Returns

`OpenBlahApiError`

#### Overrides

`Error.constructor`

## Properties

### body

> `readonly` **body**: `unknown`

---

### status

> `readonly` **status**: `number`
