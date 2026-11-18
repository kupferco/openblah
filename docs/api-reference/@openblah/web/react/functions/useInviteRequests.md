# Function: useInviteRequests()

> **useInviteRequests**(`handler`): `void`

Host: be called when the agent was asked to invite someone ("Blah, invite my mother").
Pick the contact, then resolve with `"sent"` once you shared a link, or `"declined"`.
The response is sent to the agent for you.

## Parameters

### handler

(`request`) => `Promise`\<`"sent"` \| `"declined"`\>

## Returns

`void`
