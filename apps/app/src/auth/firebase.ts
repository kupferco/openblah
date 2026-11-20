import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  OAuthProvider,
  getAuth,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithCredential,
  signInWithEmailLink,
  signOut,
  type Auth,
} from "firebase/auth";
import { config } from "../config.js";
import type { AuthService, AuthUser } from "./types.js";

const EMAIL_KEY = "openblah.pendingEmail";

/**
 * Firebase Auth with email link and Google. Needs the providers enabled in the Firebase
 * project (done in T14) and the `EXPO_PUBLIC_FIREBASE_*` values. Not unit-tested: it only
 * wires the Firebase SDK to {@link AuthService}; run it on a device.
 */
export function createFirebaseAuth(): AuthService {
  WebBrowser.maybeCompleteAuthSession();
  const app = initializeApp(config.firebase);
  const auth: Auth = getAuth(app);
  const toUser = (u: { uid: string; email: string | null; displayName: string | null } | null) =>
    u ? ({ uid: u.uid, email: u.email, displayName: u.displayName } satisfies AuthUser) : null;

  return {
    subscribe: (cb) => onAuthStateChanged(auth, (u) => cb(toUser(u))),
    async sendEmailLink(email) {
      await sendSignInLinkToEmail(auth, email, {
        url: config.emailLinkUrl,
        handleCodeInApp: true,
        iOS: { bundleId: "dev.openblah.app" },
      });
      await AsyncStorage.setItem(EMAIL_KEY, email);
    },
    async completeEmailLink(url) {
      if (!isSignInWithEmailLink(auth, url)) return false;
      const email = await AsyncStorage.getItem(EMAIL_KEY);
      if (!email) throw new Error("Open the link on the same phone where you asked for it.");
      await signInWithEmailLink(auth, email, url);
      await AsyncStorage.removeItem(EMAIL_KEY);
      return true;
    },
    async signInWithGoogle() {
      const result = await googlePrompt();
      await signInWithCredential(auth, GoogleAuthProvider.credential(result));
    },
    async appleAvailable() {
      if (!config.paidApple) return false;
      return (await import("expo-apple-authentication")).isAvailableAsync();
    },
    async signInWithApple() {
      if (!config.paidApple) throw new Error("Sign in with Apple needs the paid Apple account");
      const AppleAuthentication = await import("expo-apple-authentication");
      // Firebase wants the raw nonce; Apple gets its SHA-256 hash.
      const nonce = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      let apple;
      try {
        apple = await AppleAuthentication.signInAsync({
          requestedScopes: [
            AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
            AppleAuthentication.AppleAuthenticationScope.EMAIL,
          ],
          nonce: hashed,
        });
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_REQUEST_CANCELED") {
          throw new Error("Apple sign-in was cancelled");
        }
        throw e;
      }
      if (!apple.identityToken) throw new Error("Apple did not return an identity token");
      const credential = new OAuthProvider("apple.com").credential({
        idToken: apple.identityToken,
        rawNonce: nonce,
      });
      await signInWithCredential(auth, credential);
    },
    signOut: () => signOut(auth),
    async getIdToken() {
      if (!auth.currentUser) throw new Error("Not signed in");
      return auth.currentUser.getIdToken();
    },
  };
}

/** Runs the Google consent in a browser sheet and returns the ID token. */
async function googlePrompt(): Promise<string> {
  const discovery = { authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth" };
  const { AuthRequest, makeRedirectUri, ResponseType } = await import("expo-auth-session");
  const request = new AuthRequest({
    clientId: config.googleClientId,
    redirectUri: makeRedirectUri({ scheme: "openblah" }),
    responseType: ResponseType.IdToken,
    scopes: ["openid", "profile", "email"],
    extraParams: { nonce: Math.random().toString(36).slice(2) },
  });
  const res = await request.promptAsync(discovery);
  if (res.type !== "success" || !res.params.id_token) {
    throw new Error("Google sign-in was cancelled");
  }
  return res.params.id_token;
}
