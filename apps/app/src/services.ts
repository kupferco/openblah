import { OpenBlahApi } from "@openblah/react-native";
import type { AuthService } from "./auth/types.js";
import { config } from "./config.js";

/** The API client for the signed-in user: every call carries a fresh Firebase ID token. */
export function createApi(auth: AuthService, baseUrl: string = config.api): OpenBlahApi {
  return new OpenBlahApi({
    baseUrl,
    headers: async () => ({ authorization: `Bearer ${await auth.getIdToken()}` }),
  });
}
