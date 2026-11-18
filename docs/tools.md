# Tools: write confirmation and webhook tools

The agent calls tools from MCP servers (T12) and from webhook tools (T13). Both
are passed per room at creation, in the `mcp` object of `POST /v1/rooms`. The
`mcp` object holds tokens and secrets, so it stays on the server and is never
returned to clients.

## Read or write

A tool is **read-only** (runs freely) only if its MCP annotation
`readOnlyHint` is `true`. Anything else, including a tool with no annotations,
counts as **write** and needs confirmation. The host can override per tool name
in the room config; the override beats the annotation:

```json
{ "mcp": { "toolOverrides": { "search_menu": "read", "get_balance": "write" } } }
```

## Confirmation flow

1. The owner asks for something that changes things. The tool does not run.
   The agent gets back "not done yet, read back and ask", and the owner's SDK
   gets a pending approval (`useToolApprovals().pending`).
2. The agent reads back what it will do ("Book a table for four at 19:30, OK?").
3. The owner says yes out loud (the agent then calls an internal confirmation
   tool), or taps confirm. Only then the tool runs.

Rules, all covered by tests:

- Only the **owner of the tool credentials** can confirm: the person the
  connection belongs to (`ownerId` of the server or webhook tool, default the
  room's `ownerId`, i.e. the host). A confirmation from anyone else is rejected
  and logged as `denied`; the action stays pending.
- Only the owner can start a write in the first place.
- A spoken yes only counts if the owner spoke after the read-back, so the model
  cannot confirm on its own.
- Pending actions lapse after 2 minutes and are logged as `declined`.
- A "no" or "cancel" logs `declined` and nothing runs.

### Tapped confirmation

- **SDK** (`@openblah/web` and `@openblah/react-native`):
  `useToolApprovals()` returns `{ pending, approve(id), decline(id) }`. Each
  pending item has `id`, `tool`, `summary`, `ownerId`, `expiresAt`. Requests are
  only shown to the owner. The answer goes to the agent over LiveKit; the agent
  checks the sender's identity. The dev page (`packages/web/dev`) renders a
  confirmation card.
- **Server**: `POST /v1/rooms/:id/approvals/:approvalId` with `actorUserId` and
  `approve`. For the host app's backend. The server accepts the host or any
  `ownerId` in the room's tool config, then forwards the decision to the agent
  as a server data message (topic `openblah.approval.decision`). The agent
  trusts that topic only when it has no sending participant (it came from the
  server) and checks the actor against the pending action's owner again.

## Webhook tools

For apps that do not run MCP. Passed at room creation:

```json
{
  "mcp": {
    "webhookTools": [
      {
        "name": "send_sms",
        "description": "Send a text message",
        "inputSchema": { "type": "object", "properties": { "to": { "type": "string" } } },
        "url": "https://app.example.com/openblah/send_sms",
        "secret": "shared-hmac-secret",
        "timeoutMs": 10000,
        "readOnly": false,
        "ownerId": "user-1"
      }
    ]
  }
}
```

- Webhook tools are **write** unless `readOnly: true`, and follow the same
  confirmation rules. `toolOverrides` also applies.
- `url` must be `https` (plain `http` only for localhost). Redirects are not followed.
- Request: `POST` with JSON `{ tool, arguments, roomId, approvalId? }` (`approvalId`
  is set for confirmed writes) and headers `X-OpenBlah-Timestamp` (unix seconds)
  and `X-OpenBlah-Signature: sha256=<hex>`, where the signature is
  `HMAC-SHA256(secret, timestamp + "." + rawBody)`. The receiver should recompute
  it, compare in constant time and reject old timestamps.
- Reply: any 2xx. A JSON body `{ "text": "..." }` or `{ "result": ... }` is read
  out; otherwise the plain body. Non-2xx counts as an error.
- Default timeout 10 s (`timeoutMs`); on timeout the action is logged as `error`
  ("webhook timed out") and the agent tells the person it did not work.
- The secret is never logged or put in results.

## Action log

Every tool call is logged (`mcp_action` events in the agent's structured log):
who asked, whose credentials, tool, arguments, status
(`ok`, `error`, `denied`, `pending`, `declined`) and, for confirmed writes, a
`confirmation` object: `{ via: "voice" | "tap", by, at, approvalId, summary }`.
Tokens and secrets are never in the log. Storing the log with the room in the
database comes with the history work (T19); for now it goes to the log stream.
