import { createRemoteJWKSet, jwtVerify } from "jose";

/** A verified identity from the standalone app's sign-in. */
export interface VerifiedUser {
  uid: string;
  email?: string;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<VerifiedUser | null>;
}

const JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

/** Verifies Firebase Auth ID tokens (RS256, issuer and audience from the project ID). */
export class FirebaseTokenVerifier implements TokenVerifier {
  constructor(private readonly projectId: string) {}

  async verify(idToken: string): Promise<VerifiedUser | null> {
    try {
      const { payload } = await jwtVerify(idToken, JWKS, {
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
        algorithms: ["RS256"],
      });
      if (typeof payload.sub !== "string" || !payload.sub) return null;
      return {
        uid: payload.sub,
        email: typeof payload.email === "string" ? payload.email : undefined,
      };
    } catch {
      return null;
    }
  }
}

/** Minimal user record for the standalone app. */
export interface UserRecord {
  id: string;
  email?: string;
  /** Test accounts are left out of analytics, metrics, counts and exports. */
  isTest: boolean;
  createdAt: string;
}

/** The preview test user (see CLAUDE.md). */
export const PREVIEW_TEST_EMAIL = "preview-test@viber.invalid";
