# iOS release: free-account build, and the paid path for later (T26)

**Current decision: no paid Apple Developer Program for now (cost).** The app runs as a dev build signed with a free personal Apple ID through Xcode, installed on your own iPhone and re-signed every 7 days. Everything that needs the paid account (Sign in with Apple, universal links, push, App Store Connect, TestFlight, `eas submit`) is switched off by default and kept in the repo behind one flag, `EXPO_PUBLIC_OPENBLAH_PAID_APPLE=1`, so it can come back later. Nothing here was run on a device or sent to Apple.

## Free account build

You need a Mac with Xcode, an iPhone with a cable, and any Apple ID (no payment). Sign-in is **email link** (opens the app through the `openblah://` scheme) or **Google**; there is no Apple button.

1. Once, on the Mac: `pnpm install && pnpm --filter @openblah/react-native build`. Put the `EXPO_PUBLIC_*` values from `docs/app.md` in `apps/app/.env`.
2. Generate the Xcode project: `cd apps/app && npx expo prebuild --platform ios --clean`. Leave `EXPO_PUBLIC_OPENBLAH_PAID_APPLE` unset, so no paid entitlements are added.
3. `open ios/OpenBlah.xcworkspace`.
4. In Xcode, Xcode > Settings > Accounts > **+** > Apple ID: sign in with your normal Apple ID. A "(Personal Team)" appears.
5. In the left list click the **OpenBlah** project, then the **OpenBlah** target > **Signing & Capabilities**. Tick **Automatically manage signing** and choose your **Personal Team**. If Xcode says the bundle identifier is taken, change it to something unique such as `dev.<yourname>.openblah` (local only, do not commit). There must be no Associated Domains or Sign in with Apple capability listed.
6. Plug in the iPhone, unlock it and tap **Trust**. On iOS 16+ turn on Settings > Privacy & Security > **Developer Mode** and restart. Pick the iPhone in Xcode's device menu (top bar).
7. Press **Run** (the play button). First launch fails with "Untrusted Developer": on the phone, Settings > General > **VPN & Device Management** > your Apple ID > **Trust**, then open the app again.
8. Start the dev server on the Mac, on the same Wi-Fi: `cd apps/app && pnpm start` (port 8098). The app finds it; if it asks, enter the Mac's address and `8098`.
9. Email link: the first time, publish the small redirect page with `firebase deploy --only hosting` (free, Firebase CLI logged in). Then ask for the link in the app and open the email **on the same phone**. The link opens `https://openblah.web.app/signin/`, which hands it to the app through `openblah://signin?link=...`.

### Rebuild after 7 days

The free signing expires after 7 days and the app stops opening. Plug in the phone, open `apps/app/ios/OpenBlah.xcworkspace`, choose the phone and press **Run** again. That re-signs and reinstalls it, and keeps your data. (If the `ios/` folder is gone, redo steps 2-6.) A free Apple ID may only have 3 apps installed this way at a time.

### What the free build does not have

Sign in with Apple, universal links (`https://openblah.web.app/j/<token>` opens the browser guest page, not the app; `openblah://j/<token>` does open the app), push notifications, TestFlight and the App Store. Calls, Google sign-in, email-link sign-in, background audio and Bluetooth work.

## Later: when the paid account exists

Not part of this task; none of it blocks it. To do when the cost is accepted:

1. Enrol in the Apple Developer Program.
2. Create the App ID `dev.openblah.app` with Associated Domains and Sign in with Apple, and an App Store Connect app record.
3. Build with `EXPO_PUBLIC_OPENBLAH_PAID_APPLE=1` (adds the entitlements, the Apple plugin and the Apple button), fill in the placeholders and check them: `node scripts/check-release-config.mjs --paid --release`.
4. Copy the `submit` block from `apps/app/eas.paid.json` into `eas.json`, add the secrets below, then `eas build` and `eas submit`, and install through TestFlight.

The sections below describe that paid path.

## What is in the repo

| File                                                    | What                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/app.json`                                     | Bundle ID `dev.openblah.app`, scheme, icon and splash (free-account defaults)                                                       |
| `apps/app/app.config.js`                                | Adds the paid-only pieces (`associatedDomains`, `usesAppleSignIn`, Apple plugin, Android intent filter) when the flag is on         |
| `apps/app/eas.paid.json`                                | The `eas submit` profile with its placeholders, parked until the paid account exists                                                |
| `hosting/public/signin/index.html`                      | Email-link landing page: forwards to `openblah://signin?link=...`                                                                   |
| `apps/app/assets/`                                      | Placeholder icon, adaptive icon and splash (flat colour). Replace with real art before the App Store                                |
| `apps/app/eas.json`                                     | EAS Build profiles `development`, `preview`, `production` and the Submit profile                                                    |
| `firebase.json`                                         | Firebase Hosting for `openblah.web.app`: serves `hosting/public`, sets the AASA content type, rewrites `/j/**`                      |
| `hosting/public/.well-known/apple-app-site-association` | The AASA file (no extension, JSON). Claims `/j/*` for the app                                                                       |
| `hosting/public/.well-known/assetlinks.json`            | Android App Links file, for later (no Android build yet)                                                                            |
| `hosting/public/j/index.html`                           | Fallback when the app is not installed: sends the browser on to the guest page `https://openblah.vercel.app/j/<token>`              |
| `scripts/check-release-config.mjs`                      | Lints all of the above (run by `pnpm test`). `--paid --release` also fails with a `::viber-manual::` marker while placeholders stay |

Placeholders that remain until the paid account exists, checked only with `--paid`: `APPLE_TEAM_ID` (AASA, `eas.paid.json`) and `APP_STORE_CONNECT_APP_ID` (`eas.paid.json`); the Android file has `ANDROID_SHA256_FINGERPRINT`.

## How an invite link behaves

`https://openblah.web.app/j/<token>`:

1. App installed and the AASA file verified by iOS: the app opens. `src/invite-link.ts` reads the token. Joining a call from an invite comes with T25; for now the home screen says an invite link was opened.
2. Not installed (or opened in a browser): Firebase Hosting rewrites `/j/**` to `j/index.html`, which redirects to the guest page on Vercel with the same token (the page that already works, see `guest-web.md`).

iOS fetches the AASA file from `https://openblah.web.app/.well-known/apple-app-site-association` through Apple's CDN, so changes can take a while to show; delete and reinstall the app to force a re-check. Tapping the link inside the same domain's Safari page does not open the app (an iOS rule): test from Messages or Notes.

## Which capabilities need the paid account (the plan's "Verify")

From Apple's documentation as we know it; **re-check each in Xcode once the account exists**, since Apple changes this.

| Capability                 | Free Personal Team                                          | Paid Developer Program |
| -------------------------- | ----------------------------------------------------------- | ---------------------- |
| Associated Domains         | No (not offered). Universal links do not work on dev builds | Yes                    |
| Sign in with Apple         | No (not offered)                                            | Yes                    |
| Background audio (`audio`) | Works: it is an Info.plist `UIBackgroundModes` value        | Yes                    |
| Push notifications         | No                                                          | Yes (not used yet)     |
| Run on your own device     | Yes, 7-day signing                                          | Yes, 1 year            |
| TestFlight / App Store     | No                                                          | Yes                    |

Consequence: the default build leaves out Associated Domains and Sign in with Apple, so it signs with a free personal team. Email link (custom scheme) and Google keep working.

## Sign in with Apple

The app shows "Continue with Apple" where `AppleAuthentication.isAvailableAsync()` is true (iOS 13+), next to Google (the App Store requires it, guideline 4.8). It uses a random nonce: Apple gets the SHA-256, Firebase gets the raw value, then `signInWithCredential(OAuthProvider("apple.com"))`. Needs, once:

- In the Apple Developer portal, the App ID `dev.openblah.app` with Sign in with Apple and Associated Domains enabled.
- In the Firebase console, Authentication > Sign-in method > Apple: enable it. For a native app only the bundle ID is needed (no service ID or key).

## Owner steps for the paid path (later)

1. Enrol in the Apple Developer Program.
2. Create the App ID `dev.openblah.app` with **Associated Domains** and **Sign in with Apple**, and an App Store Connect app record (note its numeric Apple ID).
3. Fill in the placeholders, then check: `node scripts/check-release-config.mjs --paid --release` (prints "release config ok" when done).
   - `APPLE_TEAM_ID`: your 10-character Team ID (Membership page) in `hosting/public/.well-known/apple-app-site-association` and `apps/app/eas.paid.json`.
   - `APP_STORE_CONNECT_APP_ID` in `apps/app/eas.paid.json`.
4. Publish the AASA file: `firebase deploy --only hosting` (Firebase CLI logged in to the project). Check `curl -i https://openblah.web.app/.well-known/apple-app-site-association` returns 200 with `content-type: application/json` and no redirect.
5. Add the credentials as secrets, never in the repo:
   - `EXPO_TOKEN`: an Expo access token (expo.dev > Account settings > Access tokens).
   - `APP_STORE_CONNECT_API_KEY` (the `.p8` contents), `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`: an App Store Connect API key (Users and Access > Integrations), used by `eas submit`.
     EAS can instead manage signing certificates for you: `eas credentials` the first time.
6. Build and upload, from a Mac or CI with those secrets:

   ```sh
   cd apps/app   # with EXPO_PUBLIC_OPENBLAH_PAID_APPLE=1 and the submit block copied into eas.json
   npx eas-cli login
   npx eas-cli build --platform ios --profile production
   npx eas-cli submit --platform ios --profile production --latest
   ```

7. In App Store Connect > TestFlight, add yourself as an internal tester and install from the TestFlight app.
8. Check: send yourself `https://openblah.web.app/j/<any 8+ characters>` in Messages, long-press and tap the link: the app opens and says an invite link was opened. Delete the app and tap again: the browser lands on the guest page.

### Without EAS (Xcode only)

```sh
pnpm install && pnpm --filter @openblah/react-native build
cd apps/app && npx expo prebuild --platform ios
open ios/OpenBlah.xcworkspace
```

In Xcode, choose the team, confirm the capabilities **Associated Domains** (`applinks:openblah.web.app`), **Sign in with Apple** and **Background Modes > Audio** are present, then Product > Archive > Distribute App > App Store Connect.

## App Store review notes

- Microphone text is set through the SDK plugin (`microphonePermission`). The app is an AI voice assistant: say so in the review notes and describe the consent screen shown before the agent joins.
- `ITSAppUsesNonExemptEncryption` is `false` (only standard HTTPS and WebRTC): confirm with Apple's export questions when submitting.
- Placeholder icon and splash must be replaced with real artwork (1024x1024 PNG, no transparency for the iOS icon).
