# OpenBlah

**An open-source voice layer for group conversations, with an AI in the middle.**

> **Status:** early and under active development. Nothing described below exists yet; it is all planned.

Think of OpenBlah as a walking meeting room. Your phone stays in your pocket, you talk, and you can invite others (family, colleagues) into the same voice room. They can join through the app, or through a browser link with nothing to install.

The AI agent is a participant in the room. It:

- listens and takes notes
- answers, or gives its opinion, when asked
- searches or does tasks using your own tools
- knows when to stay quiet

Voice only at first. No video.

## Planned

- A hosted voice server built on [LiveKit](https://livekit.io)
- npm packages for web and React Native (Expo), so other apps can add good voice by installing one package
- Later, an Apple Watch client: tap a watch-face complication and talk

## Repo layout

A pnpm workspaces monorepo (Node 20+, TypeScript strict).

| Path                    | Package                         | What it will be                                       |
| ----------------------- | ------------------------------- | ----------------------------------------------------- |
| `packages/server`       | `@openblah/server`              | Hosted voice server (LiveKit rooms, tokens, API keys) |
| `packages/agent`        | `@openblah/agent`               | The AI agent that joins rooms                         |
| `packages/core`         | `@openblah/core`                | Client and hooks shared by the web and RN packages    |
| `packages/web`          | `@openblah/web`                 | npm package for browsers                              |
| `packages/react-native` | `@openblah/react-native`        | npm package for React Native (Expo)                   |
| `apps/app`              | `@openblah/app` (private)       | Standalone app                                        |
| `apps/example`          | `@openblah/example` (private)   | Expo dev-build example for the React Native SDK       |
| `apps/guest-web`        | `@openblah/guest-web` (private) | Browser guest page                                    |
| `docs/`                 |                                 | `plan.md` and `tasks.md`                              |

Each package currently holds only a placeholder `src/index.ts` and a test.

## Commands

```sh
pnpm install     # install dependencies
pnpm typecheck   # tsc in every package
pnpm lint        # ESLint and Prettier check
pnpm test        # Vitest
pnpm build       # build every package
pnpm format      # fix formatting
```

Copy `.env.example` to `.env` for the variables later tasks will use. CI runs the same four checks on pull requests.

## Server

`packages/server` runs with `pnpm --filter @openblah/server dev` (needs a `.env`, see `.env.example`). Endpoints and Cloud Run deploy steps are in [docs/deploy.md](docs/deploy.md).

## Licence

Open source under the [MIT licence](LICENSE).

The React Native SDK and its example app are described in [docs/react-native.md](docs/react-native.md).
