# Function: startWarmup()

> **startWarmup**(`options`, `doc?`): () => `void`

Warm up now (the client opened) and again whenever the page becomes visible.
Returns a function that stops listening. Outside a browser it warms up once.

## Parameters

### options

[`WarmupOptions`](../interfaces/WarmupOptions.md)

### doc?

[`VisibilityDocument`](../interfaces/VisibilityDocument.md)

## Returns

() => `void`
