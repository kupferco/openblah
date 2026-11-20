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
  /**
   * Where the email link goes after Firebase checks it: an authorised Firebase domain. The free
   * build uses the hosted page `https://openblah.web.app/signin/`, which hands the link to the app
   * through the `openblah://` scheme.
   */
  emailLinkUrl: process.env.EXPO_PUBLIC_EMAIL_LINK_URL ?? "https://openblah.web.app/signin/",
  /**
   * Features that need the paid Apple Developer Program (Sign in with Apple, universal links).
   * Off by default: the free-account build cannot sign them. Set `EXPO_PUBLIC_OPENBLAH_PAID_APPLE=1`
   * for both the build (`app.config.js`) and the JS bundle.
   */
  paidApple: process.env.EXPO_PUBLIC_OPENBLAH_PAID_APPLE === "1",
};
