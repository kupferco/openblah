/**
 * Fake invite server for preview builds (`VITE_MOCK_SERVER=1`). Token "demo" is a valid
 * invite, "expired" gives the not-valid answer. Joining fails at the media step: there is no real room.
 */
export function installMockServer(): void {
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const m = /\/invites\/([^/]+)$/.exec(new URL(url, location.href).pathname);
    if (m && (init?.method ?? "GET") === "GET") {
      if (m[1] !== "demo") return Response.json({ error: "invite is not valid" }, { status: 404 });
      return Response.json({
        hostDisplayName: "Alex (demo)",
        agent: "on",
        agentName: "Blah",
        consent: {
          version: "v1",
          text: "Blah, an AI assistant, will listen to this call and take notes.",
        },
      });
    }
    return real(input, init);
  };
}
