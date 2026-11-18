# Function: warmup()

> **warmup**(`options`): `Promise`\<[`WarmupStatus`](../type-aliases/WarmupStatus.md)\>

Ask the server to start the agent worker (it scales to zero) so it is ready
when the user taps to talk. Cheap and idempotent; never throws. A failed
warm-up only means the agent may take a few seconds longer to join.

## Parameters

### options

[`WarmupOptions`](../interfaces/WarmupOptions.md)

## Returns

`Promise`\<[`WarmupStatus`](../type-aliases/WarmupStatus.md)\>
