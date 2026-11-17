# OpenBlah clickable mock

Static, self-contained HTML/CSS/JS. Fake data only: no calls, LiveKit, server or auth.
Open `index.html` (or serve this folder with any static server). Links are relative, so it works under any path.

- `shared/tokens.css`: design tokens (colour, type, spacing, radii). Reuse these in the real UI.
- `shared/base.css`, `shared/call.css`: components built on the tokens.
- `shared/mock.js`: helpers, the state switcher and the shared call view.
- Flows: `join/` (desktop), `join-mobile/`, `call/`, `app/`, `watch/`.
- `screenshots/`: phone and desktop captures of each flow.
