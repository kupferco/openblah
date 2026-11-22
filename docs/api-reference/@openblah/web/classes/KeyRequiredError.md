# Class: KeyRequiredError

The server answered `402 key_required`: the product does not pay for this user's voice (any
more). Show "Add your own key to keep using voice" and the add-key sheet; never a generic error.

## Extends

- [`OpenBlahApiError`](OpenBlahApiError.md)

## Constructors

### Constructor

> **new KeyRequiredError**(`message`, `reason`, `body`): `KeyRequiredError`

#### Parameters

##### message

`string`

##### reason

[`KeyRequiredReason`](../type-aliases/KeyRequiredReason.md)

##### body

`unknown`

#### Returns

`KeyRequiredError`

#### Overrides

[`OpenBlahApiError`](OpenBlahApiError.md).[`constructor`](OpenBlahApiError.md#constructor)

## Properties

### body

> `readonly` **body**: `unknown`

#### Inherited from

[`OpenBlahApiError`](OpenBlahApiError.md).[`body`](OpenBlahApiError.md#body)

---

### reason

> `readonly` **reason**: [`KeyRequiredReason`](../type-aliases/KeyRequiredReason.md)

---

### status

> `readonly` **status**: `number`

#### Inherited from

[`OpenBlahApiError`](OpenBlahApiError.md).[`status`](OpenBlahApiError.md#status)
