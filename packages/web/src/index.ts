/**
 * @openblah/web: web SDK for OpenBlah voice rooms. 0.x, unstable.
 * The React hooks live in `@openblah/web/react` so the core works without React.
 * @module @openblah/web
 */
export * from "@openblah/core";
export { copyInviteLink, type ClipboardLike } from "./invite.js";
export { connectMcpInBrowser, type ConnectMcpInBrowserOptions } from "./mcp.js";
