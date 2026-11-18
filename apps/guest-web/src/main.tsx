import { createRoot } from "react-dom/client";
import { OpenBlahClient } from "@openblah/web";
import { OpenBlahProvider } from "@openblah/web/react";
import { App } from "./App.js";
import { checkBrowserSupport, historyAvailable, tokenFromPath } from "./lib.js";
import { startMicCheck } from "./mic.js";
import "./style.css";

// Public server URL baked in at build time. Guests need no API key.
const apiBase = (import.meta.env.VITE_OPENBLAH_API_URL as string | undefined) ?? "/v1";
const livekitUrl = import.meta.env.VITE_LIVEKIT_URL as string | undefined;

async function start() {
  // Preview builds only (build flag, not a URL parameter): answer the invite calls with fake data.
  if (import.meta.env.VITE_MOCK_SERVER === "1") (await import("./mock.js")).installMockServer();

  const token = tokenFromPath(location.pathname);
  const client = new OpenBlahClient({
    api: { baseUrl: apiBase },
    ...(livekitUrl ? { livekitUrl } : {}),
  });
  const support = checkBrowserSupport({
    RTCPeerConnection: (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection,
    mediaDevices: navigator.mediaDevices,
    isSecureContext: window.isSecureContext,
  });
  createRoot(document.getElementById("root")!).render(
    <OpenBlahProvider client={client}>
      <App
        token={token}
        support={support}
        startMic={startMicCheck}
        checkHistory={(t) => historyAvailable(apiBase, t)}
        historyUrl={(t) => `${location.origin}/j/${encodeURIComponent(t)}/history`}
      />
    </OpenBlahProvider>,
  );
}
void start();
