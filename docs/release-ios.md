# iOS release: TestFlight and universal links (T26)

How to take `apps/app` from a dev build to TestFlight, and how `https://openblah.web.app/j/<token>` opens the app. Everything here is config and files in the repo; the steps that need the Apple Developer account are the owner's (listed at the end). Nothing was run on a device or sent to Apple.

## What is in the repo

| File                                                    | What                                                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `apps/app/app.json`                                     | Bundle ID `dev.openblah.app`, icon and splash, `associatedDomains`, `usesAppleSignIn`, Android App Links intent filter       |
| `apps/app/assets/`                                      | Placeholder icon, adaptive icon and splash (flat colour). Replace with real art before the App Store                         |
| `apps/app/eas.json`                                     | EAS Build profiles `development`, `preview`, `production` and the Submit profile                                             |
| `firebase.json`                                         | Firebase Hosting for `openblah.web.app`: serves `hosting/public`, sets the AASA content type, rewrites `/j/**`               |
| `hosting/public/.well-known/apple-app-site-association` | The AASA file (no extension, JSON). Claims `/j/*` for the app                                                                |
| `hosting/public/.well-known/assetlinks.json`            | Android App Links file, for later (no Android build yet)                                                                     |
| `hosting/public/j/index.html`                           | Fallback when the app is not installed: sends the browser on to the guest page `https://openblah.vercel.app/j/<token>`       |
| `scripts/check-release-config.mjs`                      | Lints all of the above (run by `pnpm test`). `--release` also fails with a `::viber-manual::` marker while placeholders stay |

Two placeholders remain until the Apple account exists: `APPLE_TEAM_ID` (AASA, `eas.json`) and `APP_STORE_CONNECT_APP_ID` (`eas.json`); the Android file has `ANDROID_SHA256_FINGERPRINT`.

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

Consequence: until the account exists, the dev build from `docs/app.md` still runs, but the Apple sign-in button and universal links only work from a paid-account build. Email link and Google keep working. If a free-profile build fails to sign because of the entitlements, remove `associatedDomains` and `usesAppleSignIn` from `app.json` locally (do not commit that).

## Sign in with Apple

The app shows "Continue with Apple" where `AppleAuthentication.isAvailableAsync()` is true (iOS 13+), next to Google (the App Store requires it, guideline 4.8). It uses a random nonce: Apple gets the SHA-256, Firebase gets the raw value, then `signInWithCredential(OAuthProvider("apple.com"))`. Needs, once:

- In the Apple Developer portal, the App ID `dev.openblah.app` with Sign in with Apple and Associated Domains enabled.
- In the Firebase console, Authentication > Sign-in method > Apple: enable it. For a native app only the bundle ID is needed (no service ID or key).

## Owner steps (Dani)

1. Enrol in the Apple Developer Program.
2. Create the App ID `dev.openblah.app` with **Associated Domains** and **Sign in with Apple**, and an App Store Connect app record (note its numeric Apple ID).
3. Fill in the placeholders, then check: `node scripts/check-release-config.mjs --release` (prints "release config ok" when done).
   - `APPLE_TEAM_ID`: your 10-character Team ID (Membership page) in `hosting/public/.well-known/apple-app-site-association` and `apps/app/eas.json`.
   - `APP_STORE_CONNECT_APP_ID` in `apps/app/eas.json`.
4. Publish the AASA file: `firebase deploy --only hosting` (Firebase CLI logged in to the project). Check `curl -i https://openblah.web.app/.well-known/apple-app-site-association` returns 200 with `content-type: application/json` and no redirect.
5. Add the credentials as secrets, never in the repo:
   - `EXPO_TOKEN`: an Expo access token (expo.dev > Account settings > Access tokens).
   - `APP_STORE_CONNECT_API_KEY` (the `.p8` contents), `APP_STORE_CONNECT_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`: an App Store Connect API key (Users and Access > Integrations), used by `eas submit`.
     EAS can instead manage signing certificates for you: `eas credentials` the first time.
6. Build and upload, from a Mac or CI with those secrets:

   ```sh
   cd apps/app
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
