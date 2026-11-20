import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { createElement } from "react";
import { AppRoot } from "./AppRoot.js";
import { appState, shared } from "./test-support/react-native.js";
import { fakeAuth, fakePrefs, fakeServer } from "./test-support/server.js";

vi.mock("react-native", () => import("./test-support/react-native.js"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => {});
const texts = (r: ReactTestRenderer): string[] =>
  r.root
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => [n.props.children].flat().join(""));
const button = (r: ReactTestRenderer, label: string): ReactTestInstance => {
  const found = r.root.findAll(
    (n) => (n.type as unknown) === "Pressable" && n.props.accessibilityLabel === label,
  );
  if (found.length !== 1) throw new Error(`button "${label}": ${found.length} in ${texts(r)}`);
  return found[0]!;
};
const press = async (r: ReactTestRenderer, label: string) => {
  await act(async () => button(r, label).props.onPress());
  await flush();
};
const type = async (r: ReactTestRenderer, label: string, value: string) => {
  const input = r.root.findAll(
    (n) => (n.type as unknown) === "TextInput" && n.props.accessibilityLabel === label,
  )[0]!;
  await act(async () => input.props.onChangeText(value));
};

function mount(refuse = false) {
  const { auth, emit } = fakeAuth();
  const server = fakeServer();
  server.state.usable = true;
  const sessions: string[] = [];
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      createElement(AppRoot, {
        auth,
        api: server.api,
        client: server.client,
        prefs: fakePrefs(),
        livekitUrl: "wss://fallback.test",
        // The consent page: the person agrees, so the server marks the connection connected.
        openAuthSession: async (url: string) => {
          sessions.push(url);
          for (const c of server.state.mcp) {
            if (c.status !== "pending") continue;
            Object.assign(
              c,
              refuse ? { status: "error", error: "access_denied" } : { status: "connected" },
            );
          }
          return { type: "success" };
        },
      }),
    );
  });
  emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
  return { r, server, sessions };
}

beforeEach(() => {
  appState.handlers.clear();
  shared.messages.length = 0;
  shared.dismiss = false;
});

describe("standalone app: MCP servers, invites and history", () => {
  it("adds an MCP server by URL with the OAuth sheet, tests it and disconnects it", async () => {
    const { r, server, sessions } = mount();
    await flush();
    await press(r, "Tools");
    expect(texts(r)).toContain("No servers yet.");
    expect(button(r, "Connect server").props.disabled).toBe(true);

    await type(r, "Server URL", "https://mcp.example.com/mcp");
    await press(r, "Connect server");
    expect(sessions).toEqual(["https://auth.test/c1"]);
    expect(server.state.bodies["POST /me/mcp/connections"]).toMatchObject({
      url: "https://mcp.example.com/mcp",
    });
    expect(texts(r).join("|")).toContain(
      "mcp.example.com · https://mcp.example.com/mcp · connected",
    );

    await press(r, "Test mcp.example.com");
    expect(texts(r)).toContain("Works: 3 tools");
    server.state.mcpTest = { ok: false, message: "unauthorized" };
    await press(r, "Test mcp.example.com");
    expect(texts(r)).toContain("Failed: unauthorized");

    await press(r, "Disconnect mcp.example.com");
    expect(server.state.mcp).toEqual([]);
    expect(texts(r)).toContain("No servers yet.");
  });

  it("shows a refused sign-in as an error and keeps nothing", async () => {
    const { r } = mount(true);
    await flush();
    await press(r, "Tools");
    await type(r, "Server URL", "https://mcp.example.com/mcp");
    await press(r, "Connect server");
    expect(texts(r)).toContain("access_denied");
    expect(button(r, "Connect server").props.disabled).toBe(false);
  });

  it("invites someone by link, and the host sets notes, who can add the agent and tools", async () => {
    const { r, server } = mount();
    server.state.mcp.push(
      { id: "a", serverUrl: "https://a.test", name: "Alpha", status: "connected", createdAt: "" },
      { id: "b", serverUrl: "https://b.test", name: "Beta", status: "connected", createdAt: "" },
    );
    await flush();
    await press(r, "Start talking");
    await press(r, "I agree, start");
    await flush();
    expect(texts(r)).toContain("In a call");

    await press(r, "Invite someone");
    expect(shared.messages).toEqual(["Join my Blah call: https://openblah.web.app/j/tok1"]);
    expect(texts(r)).toContain("Invite link shared: https://openblah.web.app/j/tok1");

    await press(r, "Save notes");
    expect(server.state.saveNotes).toBe(true);
    expect(server.state.bodies["PUT /rooms/rm_1/history-settings"]).toMatchObject({
      actorUserId: "u1",
      saveNotes: true,
    });
    expect(texts(r)).toContain("Anyone can add Blah");
    await press(r, "Anyone can add Blah");
    expect(server.state.anyoneCanAdd).toBe(true);
    expect(texts(r)).toContain("Anyone can add Blah ✓");

    // Both servers on by default; switch Beta off for this room.
    expect(texts(r)).toContain("Alpha ✓");
    await press(r, "Beta ✓");
    expect(server.state.enabledMcp).toEqual(["a"]);
    expect(texts(r)).toContain("Beta (off)");
  });

  it("does not report a dismissed share sheet as shared", async () => {
    const { r } = mount();
    await flush();
    await press(r, "Start talking");
    await press(r, "I agree, start");
    await flush();
    shared.dismiss = true;
    await press(r, "Invite someone");
    expect(texts(r).join("|")).not.toContain("Invite link shared");
  });

  it("lists past calls, shows the summary and transcript, and lets the host change retention and delete", async () => {
    const { r, server } = mount();
    const call = {
      roomId: "rm_9",
      hostUserId: "u1",
      hostDisplayName: "Ana",
      participants: ["Ana", "Bruno"],
      summary: "Planned the trip.",
      savedAt: "2026-03-01T10:00:00Z",
      expiresAt: "2026-03-31T10:00:00Z",
      transcript: [{ speaker: "Bruno", text: "Let us go in May", at: "2026-03-01T09:00:00Z" }],
      notes: ["Go in May"],
      actions: [{ text: "Book flights", owner: "Ana", done: false }],
      language: "en",
      actionLog: [],
      retention: "30d",
    };
    server.state.history = [call];
    await flush();
    await press(r, "Call history");
    await press(r, "Sun Mar 01 2026 · Ana, Bruno");
    const all = texts(r);
    expect(all).toContain("Planned the trip.");
    expect(all).toContain("• Go in May");
    expect(all).toContain("○ Book flights (Ana)");
    expect(all).toContain("Bruno: Let us go in May");
    expect(all).toContain("30 days ✓");

    await press(r, "Until I delete it");
    expect(server.state.bodies["PUT /rooms/rm_9/history-settings"]).toMatchObject({
      actorUserId: "u1",
      retention: "forever",
    });
    await press(r, "Delete this call");
    expect(server.state.history).toEqual([]);
    expect(texts(r)).toContain("This call was deleted.");
    await press(r, "Back");
    expect(texts(r)).toContain(
      'No saved calls yet. Turn on "Save notes" in a call to keep its summary.',
    );
  });

  it("hides retention and delete from a participant who is not the host", async () => {
    const { r, server } = mount();
    server.state.history = [
      {
        roomId: "rm_8",
        hostUserId: "someone-else",
        hostDisplayName: "Bruno",
        participants: ["Bruno", "Ana"],
        summary: "Hi",
        savedAt: "2026-03-01T10:00:00Z",
        expiresAt: null,
        transcript: [],
        notes: [],
        actions: [],
        language: "en",
        actionLog: [],
        retention: "forever",
      },
    ];
    await flush();
    await press(r, "Call history");
    await press(r, "Sun Mar 01 2026 · Bruno, Ana");
    expect(texts(r)).toContain("Kept until the host deletes it.");
    expect(r.root.findAll((n) => n.props.accessibilityLabel === "Delete this call")).toHaveLength(
      0,
    );
  });
});
