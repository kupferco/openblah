# Guest page (apps/guest-web)

The page behind `https://openblah.vercel.app/j/<token>`. Built only on `@openblah/web`. Desktop Chrome, Safari and Firefox first; mobile is T30.

Flow: open the link, enter a name, read and tick the consent line (hidden when the room's AI is off), check the microphone (permission and level meter), join. In the call: participants, agent state, mute, leave. Guests get no agent or host controls.

Friendly states: invalid link, server unreachable, microphone blocked or missing, unsupported browser, call ended or left.

- **Invalid link.** The server answers one 404 for expired, revoked, used-up and ended-room invites on purpose, so the page cannot tell them apart and shows one message covering all of them.
- **History link (Q3 / T19).** When the call has ended the page does a `HEAD <api>/invites/<token>/history`; a 2xx shows "View call history". T19 is not live yet, so this is a feature check against an assumed route: change `historyAvailable` in `src/lib.ts` and `historyUrl` in `src/main.tsx` to match T19.

## Develop

```sh
pnpm --filter @openblah/guest-web dev      # http://localhost:5174/j/<token>
pnpm --filter @openblah/guest-web e2e      # Playwright smoke test, server mocked (needs `pnpm exec playwright install chromium` once)
```

Build-time settings: `VITE_OPENBLAH_API_URL` (server base incl. `/v1`, default `/v1`), `VITE_LIVEKIT_URL` (only if the server sends none), `VITE_MOCK_SERVER=1` (preview builds only: token `demo` is a valid fake invite, anything else is invalid; joining needs a real room). There is no login on this page.

## Deploy (Vercel)

The page is served by the existing Vercel project `openblah` (root directory `apps/landing`, https://openblah.vercel.app/), so it needs no new project, token or secret. `apps/landing/vercel.json` runs `apps/landing/build-vercel.sh`, which builds the landing page, then builds guest-web (base `/guest/`) into `dist/guest`; a rewrite sends `/j/*` to `/guest/index.html`. Vercel's PR preview therefore shows the guest page at `<preview url>/j/demo`.

- **Mock server.** `VITE_MOCK_SERVER=1` is set only when `VERCEL_ENV=preview`; production builds never get it.
- **Settings.** Set `VITE_OPENBLAH_API_URL` and `VITE_LIVEKIT_URL` as Vercel environment variables for production. The server must allow CORS from the site.
- **Needs** "Include source files outside of the Root Directory" enabled (Vercel default).
- Build, typecheck and unit tests run in the normal CI workflow (`pnpm typecheck`, `pnpm test`, `pnpm build`).

Manual test: desktop Chrome, Safari and Firefox with a real invite from the `@openblah/web` dev page.
