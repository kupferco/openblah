# SDK API stability and versioning

`@openblah/core`, `@openblah/web` and `@openblah/react-native` share one version number (changesets `fixed` group, see `.changeset/`).

## What is public

Everything exported from `@openblah/web`, `@openblah/web/react` and `@openblah/react-native` is **public** unless its TSDoc has `@internal`. Internal exports are wire-level details (data topics, attribute names, control message shapes, `deriveAgentState`, `RoomLike`). They may change in any release and are left out of the [API reference](api-reference/README.md). `@openblah/core` is shared plumbing: depend on web or react-native instead.

## Same API in both packages

| What                         | `@openblah/web`            | `@openblah/react-native`      |
| ---------------------------- | -------------------------- | ----------------------------- |
| Client, API client, types    | from `@openblah/web`       | from `@openblah/react-native` |
| Hooks and `<OpenBlahRoom />` | from `@openblah/web/react` | from `@openblah/react-native` |
| Mid-call invite              | `copyInviteLink`           | `shareInvite`                 |
| MCP sign-in                  | `connectMcpInBrowser`      | `connectMcpInApp`             |
| Client factory               | `new OpenBlahClient(...)`  | `createOpenBlahClient(...)`   |

The names, props and behaviour of hooks and the component are identical. The only differences are the import path (web keeps React out of the framework-free root) and the platform bits in the table. A new hook or prop lands in both in the same release.

## Semver rules (0.x)

While the version is `0.x`, a **minor** bump may break the API and a **patch** bump never does. From `1.0`, normal semver:

- **Breaking** (major): removing or renaming an export, changing a prop, argument or return type incompatibly, changing a documented behaviour.
- **Feature** (minor): new exports, new optional props, new theme or label keys.
- **Fix** (patch): bug fixes and docs.
- Adding a value to a string union such as `AgentState` is a feature, but write your `switch` with a default.
- Internal exports are outside these rules.

Every user-visible change gets a changeset: `pnpm changeset`. `pnpm version` applies them. Publishing: T22.

## Keeping the reference current

`pnpm docs:api` regenerates `docs/api-reference/` from the TSDoc; CI runs `pnpm docs:api:check` and fails when the committed files are stale. `pnpm licences` fails on a dependency with a licence that is not MIT-compatible; `docs/licences.md` lists them.
