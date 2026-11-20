/** Build-time settings. Set the `EXPO_PUBLIC_*` variables when starting or building the app. */
export const config = {
  /** OpenBlah server base URL including `/v1`. */
  api: process.env.EXPO_PUBLIC_OPENBLAH_API ?? "http://localhost:8080/v1",
  /** LiveKit URL, used when the server does not send one with the call. */
  livekitUrl: process.env.EXPO_PUBLIC_LIVEKIT_URL ?? "",
  /** Default agent name (Q1). The user can change it in Settings. */
  defaultAgentName: "Blah",
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
  },
  /** Google OAuth client id (iOS) for "Continue with Google". */
  googleClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "",
  /** Where the email link opens the app: needs to be an authorised Firebase domain. */
  /** Where the browser goes after an MCP server sign-in (must be allowed in the server's settings). */
  mcpReturnUrl: process.env.EXPO_PUBLIC_MCP_RETURN_URL ?? "",
  emailLinkUrl: process.env.EXPO_PUBLIC_EMAIL_LINK_URL ?? "",
};
