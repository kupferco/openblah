// Stands in for `@openblah/react-native` in tests (see the alias in vitest.config.ts): the
// SDK's own client and hooks, without the native layer (`createOpenBlahClient`, registerGlobals).
export * from "@openblah/core";
export * from "@openblah/core/react";
// The react-native helpers that only need `react-native`'s Share and Linking (stubbed in tests).
export { shareInvite } from "../../../../packages/react-native/src/invite.js";
export { connectMcpInApp } from "../../../../packages/react-native/src/mcp.js";
