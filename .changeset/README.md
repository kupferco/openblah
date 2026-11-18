# Changesets

Every user-visible change to `@openblah/core`, `@openblah/web` or `@openblah/react-native` needs a changeset: run `pnpm changeset`, pick the packages and the bump, and describe the change for the changelog. The three packages are versioned together (`fixed`). See `docs/sdk-stability.md` for what counts as a breaking change.

`pnpm version` applies the changesets (bumps versions, writes `CHANGELOG.md`). Publishing is T22.
