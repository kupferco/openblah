# Joining from a phone browser

The guest page (`apps/guest-web`, see `guest-web.md`) works on iPhone Safari and Android Chrome where it is cheap to do so. There is no redesign and no deep link into a native app beyond what T26 provides.

## What the page does on a phone

- **Audio unlock.** The Join tap starts a short silent `AudioContext`, because Safari and Chrome only allow playback after a tap.
- **Microphone.** The same check as on desktop; the blocked message tells people to allow the mic in the browser's site settings.
- **Wake lock.** While in the call the page asks for a screen wake lock and asks again when the tab becomes visible. It is best effort: unsupported, denied or low-battery is silently ignored.
- **Banner.** On phones the call screen says "Keep this tab open and the screen on".
- **Layout.** `viewport-fit=cover` with safe-area padding, 44 px touch targets on coarse pointers, 16 px inputs (no iOS zoom), no sideways scroll at 320 px.
- **Cannot join.** No WebRTC or no mic access shows "This browser can't join". In-app browsers (Facebook, Instagram, etc.) get a hint to open the link in Safari or Chrome.

## Limits we accept

- **Background and lock screen.** Mobile browsers suspend tabs. Switching apps or locking the phone usually mutes the mic and can drop the call, especially on iOS. The wake lock only stops the screen from sleeping by itself; a manual lock still suspends the tab. The page reconnects when it returns, if the room is still live.
- **Wake lock support.** iOS Safari supports it from 16.4; older versions get no lock.
- **iOS audio route.** Bluetooth and speaker switching is controlled by iOS, not the page.
- **In-app browsers** often block the microphone; the guest has to open the link in a real browser.
- **Background capture** is not available in any mobile browser; a native app (T24+) is the route for that.

## Checks

Playwright (`pnpm --filter @openblah/guest-web e2e`) runs at 320 and 390 px with touch emulation (no horizontal overflow, touch-size controls) and checks the unsupported-browser note. Unit tests cover the wake lock and detection helpers. Real devices are not covered.

Manual: open an invite on an iPhone (Safari) and, if available, Android (Chrome); join, lock the screen, come back, and report what breaks.
