# Guest page (apps/guest-web)

The page behind `https://openblah.web.app/j/<token>`. Built only on `@openblah/web`. Desktop Chrome, Safari and Firefox first; mobile is T30.

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

## Deploy (Firebase Hosting)

`firebase.json` serves `apps/guest-web/dist` on site `openblah` with an SPA rewrite. `.github/workflows/guest-web.yml` builds and deploys: a preview channel per pull request (fake server, reported to Viber, opens `/j/demo`) and the live site on `main` (with the Viber deploy report).

**Dani: manual steps**

1. Create the Firebase project and the `openblah` Hosting site so `openblah.web.app` exists (or tell us the real site ID and update `site` in `firebase.json` and `projectId`).
2. Add the repo secret `FIREBASE_SERVICE_ACCOUNT` (service account JSON with Firebase Hosting Admin; until it exists the deploy step is skipped, not failed) and, if the project ID is not `openblah`, the variable `FIREBASE_PROJECT_ID`. Set the variables `OPENBLAH_API_URL` and `LIVEKIT_URL` for production builds. The server must allow CORS from the site.
3. Test in desktop Chrome, Safari and Firefox with a real invite from the `@openblah/web` dev page.
