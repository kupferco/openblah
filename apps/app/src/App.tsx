import * as WebBrowser from "expo-web-browser";
import { useMemo } from "react";
import { createOpenBlahClient } from "@openblah/react-native";
import { AppRoot } from "./AppRoot.js";
import { createFirebaseAuth } from "./auth/firebase.js";
import { config } from "./config.js";
import { asyncStoragePrefs } from "./prefs-storage.js";
import { createApi } from "./services.js";

/** The real app: Firebase sign-in, the OpenBlah server, the native audio session. */
export default function App() {
  const deps = useMemo(() => {
    const auth = createFirebaseAuth();
    const api = createApi(auth);
    const client = createOpenBlahClient({
      api: {
        baseUrl: config.api,
        headers: async () => ({ authorization: `Bearer ${await auth.getIdToken()}` }),
      },
    });
    return { auth, api, client };
  }, []);
  return (
    <AppRoot
      {...deps}
      prefs={asyncStoragePrefs}
      openAuthSession={(url) =>
        WebBrowser.openAuthSessionAsync(url, config.mcpReturnUrl || undefined)
      }
      {...(config.mcpReturnUrl ? { mcpReturnUrl: config.mcpReturnUrl } : {})}
    />
  );
}
