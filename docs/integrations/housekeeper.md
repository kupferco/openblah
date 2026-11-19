# Housekeeper integration guide

How to replace Housekeeper's mic button with OpenBlah voice. Housekeeper is the first embedded product: single user, an agent that talks to Housekeeper's own MCP server, low risk. The generic steps are in [../host-integration.md](../host-integration.md); this page is the Housekeeper-specific order of work. TeraPay is **not** covered here (it waits for the paid-tier key decision, plan question Q5).

Status: `@openblah/react-native` is 0.x and unstable. Pin an exact version. The React Native audio path (lock screen, Bluetooth) is unit-tested but not yet checked on a device, so test on a real phone.

## What you build

```
Housekeeper app ──(1) POST /voice/session──▶ Housekeeper backend ──(2) POST /v1/rooms, /v1/tokens──▶ OpenBlah server
      │                                         (holds the OpenBlah API key)                              │
      └──(3) room token, WebRTC audio ────────────────────────────────────────────────────▶ LiveKit ◀── agent ──▶ Housekeeper MCP server
                                                                                          (agent uses the user's token)
```

The app never holds the OpenBlah API key or the user's MCP token. The backend sends the user's token to the OpenBlah server inside the room's `mcp` object; the server keeps it and the agent uses it to call Housekeeper's MCP server.

## 1. Install the SDK in the app

```sh
npx expo install @openblah/react-native @livekit/react-native @livekit/react-native-webrtc livekit-client
```

This is an **Expo dev build only**; it does not run in Expo Go (native WebRTC). Add the config plugin to `app.json`. It sets up LiveKit and WebRTC, the iOS `audio` background mode, the microphone usage text and the Android audio permissions:

```json
{
  "expo": {
    "plugins": [
      [
        "@openblah/react-native/plugin",
        { "microphonePermission": "Housekeeper uses the microphone for voice commands." }
      ]
    ]
  }
}
```

Then `npx expo prebuild` and build a dev client (`expo run:ios --device`). Details and the free-provisioning notes: [../react-native.md](../react-native.md). Register the globals first thing in the entry file:

```js
import { registerOpenBlahGlobals } from "@openblah/react-native";
registerOpenBlahGlobals();
```

## 2. Mint a room token from Housekeeper's backend

Add two routes to Housekeeper's backend. A tested sample is in [`examples/housekeeper-style/`](../../examples/housekeeper-style/):

- `src/voice-routes.ts`: `createVoiceRoutes(options)` returns a `(Request) => Promise<Response>` handler for `POST /voice/session` and `POST /voice/warmup`; `toNodeListener` mounts it on Node `http` or Express.
- `src/fake-mcp.ts`: a fake MCP server with the same token check, for local runs and tests.
- `src/voice-routes.test.ts`: the tests (`pnpm test examples`).

Mounting:

```ts
import express from "express";
import { createVoiceRoutes, toNodeListener } from "./voice-routes";

const voice = createVoiceRoutes({
  openblahUrl: process.env.OPENBLAH_URL!,
  openblahApiKey: process.env.OPENBLAH_API_KEY!, // server-side only, never in the app
  mcpUrl: process.env.HOUSEKEEPER_MCP_URL!,
  authenticate: async (req) => myExistingAuth(req), // { id, displayName, mcpToken } or null
});
app.use("/api", toNodeListener(voice)); // POST /api/voice/session, POST /api/voice/warmup
```

`/voice/session` does what [../host-integration.md](../host-integration.md) describes, in one call: `POST /v1/rooms` with `agent: "on"` and the `mcp` object, then `POST /v1/tokens` for the same user, and returns `{ roomId, token, expiresIn }`. The room is one user, so it is a plain Direct call with the agent on from the start (single-user rooms need no invite and no consent round with other people; the user still sees the agent consent text once).

### Pass the logged-in user's token

`mcp.userToken` is the token the Housekeeper app already uses for Housekeeper's MCP server. Housekeeper's MCP server trusts it, so there is **no OAuth screen** and voice never carries credentials. A tool call runs with the credentials of its owner only. Requirements on the MCP server:

- Accepts `Authorization: Bearer <user token>` on its HTTP endpoint (streamable HTTP).
- The token lives as long as a call (at most the room's max duration, 2 hours by default; lower it with `maxDurationSeconds`). If it expires faster, mint the session shortly before use or tell us.

### Allow-list the tools

Pass `allowTools` so the agent sees only what voice needs and prompts stay short. Start with the read tool and one write:

```json
{ "allowTools": ["list_tasks", "add_task"] }
```

Grow the list by hand, one tool at a time, after reading the first feedback.

### Which tools need confirmation

A tool runs freely only if its MCP annotation `readOnlyHint` is `true`. Anything else (including a tool with no annotations) is a write and needs the owner's confirmation: the agent reads the action back, the user says yes out loud or taps the confirmation card (`useToolApprovals`). Override by name with `toolOverrides` (`"read"` or `"write"`; the override wins). The sample marks `list_tasks` read and `add_task` write. Rule of thumb: anything that creates, changes, deletes, sends or pays is `write`. Never allow-list destructive tools (such as deleting an account) for voice. See [../tools.md](../tools.md).

### Product key mode

Housekeeper pays for the language and speech providers: set the provider keys for Housekeeper's OpenBlah API key on the OpenBlah server (`OPENBLAH_PRODUCT_KEYS`; see [../keys-and-trial.md](../keys-and-trial.md)). Users never see keys. The sample creates the room with `sensitive: true` because Housekeeper holds household data: free-tier keys are refused (`403 sensitive_free_tier`), so the product keys must be marked `paid` with no-training confirmed. Remove `sensitive` only if you decide the data is not sensitive.

### Per-user minute caps (T20)

Because Housekeeper pays, set `OPENBLAH_USER_MONTHLY_MINUTES` on the OpenBlah server (off by default; required for product keys to be safe) and optionally `OPENBLAH_HOST_MONTHLY_MINUTES`. Lower the per-call limits per room with `maxDurationSeconds` and `idleTimeoutSeconds` (options of the sample). When a cap is reached, the server answers `429` with `code` `user_cap` or `host_cap`; the sample passes this through, so the app can say "Voice minutes used up this month" instead of a generic error. The agent also stops mid-call at the cap. See [../costs.md](../costs.md) for the full list, and check usage with `GET /v1/rooms/:id/usage`.

## 3. Replace the mic button in the app

Mount `OpenBlahProvider` once, and let the button fetch a session and connect (the sample's mounting code is the pattern; the room component and hooks are in [../react-native.md](../react-native.md)):

```tsx
const client = createOpenBlahClient(); // once, at module level

function VoiceButton() {
  const room = useRoom();
  return (
    <Button
      title="Talk"
      onPress={async () => {
        const res = await fetch(`${API}/voice/session`, {
          method: "POST" /* + Housekeeper auth */,
        });
        if (res.status === 429) return showVoiceLimitReached();
        if (!res.ok) return showVoiceUnavailable();
        const { token } = await res.json();
        await room.connect(LIVEKIT_URL, token);
      }}
    />
  );
}
// <OpenBlahProvider client={client}><VoiceButton /></OpenBlahProvider>
```

`LIVEKIT_URL` is the OpenBlah server's LiveKit URL (it is also returned with join responses as `livekitUrl`). Use `useToolApprovals()` to show confirmation cards, `useAgentState()` to show listening / thinking / speaking, and `useMute()` for the mute button.

### Warm-up ping on app open

The agent worker scales to zero, so a cold first call takes seconds longer. Call `POST /voice/warmup` when the app opens and each time it returns to the foreground (`AppState` `change` to `active`). It needs the API key, so it goes through Housekeeper's backend (the sample route does this). It is cheap, safe to repeat, never throws in the SDK, and is rate limited to 6 per minute per user on the server.

### Direct mode, agent on

Housekeeper is single-user, so use the room as is: `agent: "on"`, the host is the only participant, and the mode is **Direct** (every turn from the host goes to the agent; nobody else's turns count). If the agent seems to listen only, switch with the mode control (host only) or say "go direct".

## Try it locally

1. Run an OpenBlah server and agent ([../deploy.md](../deploy.md)), with `OPENBLAH_API_KEYS`, provider keys and `OPENBLAH_USER_MONTHLY_MINUTES` set.
2. Start the sample backend against the fake MCP server: `OPENBLAH_URL=... OPENBLAH_API_KEY=... node --experimental-strip-types examples/housekeeper-style/src/server.ts` (stub login: `Authorization: Bearer demo-token`).
3. Then switch `mcpUrl` to Housekeeper's real MCP server.

## Tests

`pnpm test examples` runs the sample against a fake OpenBlah server and the local fake MCP server. They check: unauthenticated callers are refused; the room gets `agent: "on"`, the user's token, the allow-list and overrides; the app never receives the API key or MCP token; cap errors reach the app as 429 with their code; warm-up is per user; and the fake MCP server accepts only the right token.

## Brief for the Housekeeper repo

Paste into a new Viber task in the Housekeeper repo, once this guide is merged and `@openblah/react-native` 0.x is published:

```markdown
# Replace the mic button with OpenBlah voice

Replace Housekeeper's current mic button with OpenBlah voice using `@openblah/react-native`. Follow the OpenBlah repo's guide `docs/integrations/housekeeper.md` (https://github.com/<owner>/openblah/blob/main/docs/integrations/housekeeper.md) and the tested sample in `examples/housekeeper-style/`. Do only this.

Do:

1. App: install `@openblah/react-native` (pin the exact 0.x version) and its peers, add the Expo config plugin to `app.json`, call `registerOpenBlahGlobals()` first in the entry file. It is an Expo dev build; document the build steps in the README. Do not run the app.
2. Backend: add `POST /voice/session` and `POST /voice/warmup`, adapted from the sample. Authenticate with Housekeeper's normal session. Call OpenBlah with the API key from a server-side secret `OPENBLAH_API_KEY` (and `OPENBLAH_URL`); never ship it in the app. Create a room with `agent: "on"`, `sensitive: true`, the `mcp` object with Housekeeper's MCP server URL, the logged-in user's token as `userToken`, `allowTools` (only the tools I list below) and `toolOverrides` for anything that changes data. Return only `{ roomId, token, expiresIn }`.
3. App: replace the mic button with a Talk button that fetches a session and connects. Show the agent state, a mute button, confirmation cards for write tools (`useToolApprovals`), and a clear message when the server answers 429 (monthly voice minutes used up). Warm up on app open and on foreground.
4. Tests: backend route tests with a fake OpenBlah server and a fake MCP server (as in the sample), and component tests for the button with a mocked SDK. Run the repo's checks (typecheck, tests, build) and fix what they find.
5. Keep the old mic button behind a flag until the voice is checked on a phone.

Tools to allow-list (read): <fill in, start with the list tasks tool>. Tools that need confirmation (write): <fill in, start with add task>. Never allow tools that delete accounts or move money.

Do not: add TeraPay, add OAuth screens (the user's token is passed from the backend), commit secrets, or change production.

Dani: manual steps: set `OPENBLAH_API_KEY` and `OPENBLAH_URL` as secrets for the Housekeeper backend; add Housekeeper's provider keys to `OPENBLAH_PRODUCT_KEYS` on the OpenBlah server and set `OPENBLAH_USER_MONTHLY_MINUTES`; build the dev client on an iPhone and try it.

Done looks like: typecheck, tests and build pass; the Talk button flow is covered by tests; the README explains the dev build; the guide's feedback checklist is linked from the PR.
```

## Feedback checklist

After a week of use, collect (a line each, with examples and times):

- **Latency**: time from tap to the agent answering the first time (cold) and after warm-up; time from the end of speech to the reply; does warm-up help?
- **Tool-call mistakes**: wrong tool, wrong arguments, a write that ran without confirmation, a confirmation that was read back wrongly, a tool the agent should have used and did not.
- **Voice quality**: speech recognition errors (names, numbers, dates), voice naturalness, audio dropouts on lock screen or Bluetooth.
- **Interruptions**: does the agent stop when you talk over it; does it cut you off; background noise triggering it.
- **Portuguese quality**: recognition, spoken accuracy and tool arguments in Portuguese, and switching between English and Portuguese in one call.
- **Cost**: minutes used per user per week, against the per-user cap (`GET /v1/rooms/:id/usage`).

## Manual steps (Dani)

- Create the task in the Housekeeper repo from the brief above, once this is merged.
- Give the Housekeeper MCP server URL and how it accepts the user token (tell us if it needs changes).
