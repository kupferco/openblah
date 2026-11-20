/** The signed-in person, as far as the app needs it. */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

/**
 * Sign-in for the app itself (Q6: email link and Google). The screens only know this
 * interface; `firebase.ts` is the real implementation and tests use a fake.
 */
export interface AuthService {
  /** Calls `cb` now and on every change; `null` means signed out. Returns an unsubscribe function. */
  subscribe(cb: (user: AuthUser | null) => void): () => void;
  /** Email the person a sign-in link. */
  sendEmailLink(email: string): Promise<void>;
  /** Finish an email-link sign-in from the URL the app was opened with. False if it is not one. */
  completeEmailLink(url: string): Promise<boolean>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** A fresh ID token for the OpenBlah server's `/v1/me` endpoints. */
  getIdToken(): Promise<string>;
}
