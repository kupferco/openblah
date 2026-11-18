# Test MCP server with OAuth

A small in-memory MCP server protected by OAuth 2.1 (PKCE S256, dynamic client
registration, rotating refresh tokens, revocation). It approves every
authorization request for one fixed user. **Tests and local tries only.**

- `server.ts`: `startTestMcpOAuth()` for tests.
- `cli.ts`: run it by hand with `pnpm dlx tsx tools/test-mcp-oauth/cli.ts` (port 4010, or `PORT`).
- Used by `packages/server/src/mcp-oauth.e2e.test.ts`.
