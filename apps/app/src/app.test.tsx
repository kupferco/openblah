import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { createElement } from "react";
import { AppRoot } from "./AppRoot.js";
import { appState, linking } from "./test-support/react-native.js";
import { fakeAuth, fakePrefs, fakeServer } from "./test-support/server.js";

vi.mock("react-native", () => import("./test-support/react-native.js"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flush = () => act(async () => {});

function texts(r: ReactTestRenderer): string[] {
  return r.root
    .findAll((n) => (n.type as unknown) === "Text")
    .map((n) => [n.props.children].flat().join(""));
}
const button = (r: ReactTestRenderer, label: string): ReactTestInstance => {
  const found = r.root.findAll(
    (n) => (n.type as unknown) === "Pressable" && n.props.accessibilityLabel === label,
  );
  if (found.length !== 1)
    throw new Error(`button "${label}": ${found.length} found in ${texts(r)}`);
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

function mount() {
  const { auth, emit } = fakeAuth();
  const prefs = fakePrefs();
  const server = fakeServer();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      createElement(AppRoot, {
        auth,
        api: server.api,
        client: server.client,
        prefs,
        livekitUrl: "wss://fallback.test",
      }),
    );
  });
  return { r, auth, emit, prefs, server };
}

beforeEach(() => {
  appState.handlers.clear();
  linking.handlers.clear();
  linking.initial = null;
});

describe("standalone app", () => {
  it("shows sign-in when signed out and emails a link", async () => {
    const { r, auth } = mount();
    await flush();
    expect(texts(r)).toContain("Sign in to OpenBlah");
    expect(button(r, "Email me a sign-in link").props.disabled).toBe(true);
    await type(r, "Email", "ana@example.com");
    await press(r, "Email me a sign-in link");
    expect(auth.sendEmailLink).toHaveBeenCalledWith("ana@example.com");
    expect(texts(r)).toContain("Check your email and open the link on this phone.");
  });

  it("flows from sign-in through onboarding (trial) to a call with the agent", async () => {
    const { r, emit, server } = mount();
    await flush();
    emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
    await flush();

    // Onboarding: Gemini suggested first; the trial makes it usable.
    expect(texts(r)).toContain("Set up your assistant");
    expect(texts(r)).toContain("Gemini is the quickest way to start: a free key.");
    expect(button(r, "Continue").props.disabled).toBe(true);
    await press(r, "Start the 5-minute trial");
    expect(server.state.trialStarted).toBe(true);
    await press(r, "Continue");
    expect(server.state.calls).toContain("PUT /me/settings");

    // Home, then the consent screen before the call.
    expect(texts(r)).toContain("Hi Ana");
    await press(r, "Start talking");
    expect(texts(r)).toContain("Talk with Blah");
    expect(texts(r)).toContain("Your audio goes to Google Gemini.");
    expect(server.state.calls).not.toContain("POST /me/calls");

    // Accepting starts the room as the signed-in user and joins it.
    await press(r, "I agree, start");
    await flush();
    expect(server.state.bodies["POST /me/calls"]).toMatchObject({
      displayName: "Ana",
      agentName: "Blah",
    });
    expect(server.room.connect).toHaveBeenCalled();
    expect(texts(r)).toContain("In a call");
    expect(texts(r)).toContain("Ana (you)");

    // Mute, agent in or out and the mode switch.
    await press(r, "Mute");
    expect(server.room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
    expect(texts(r).join("|")).toContain("Blah: not in the call");

    await press(r, "Leave");
    expect(server.room.disconnect).toHaveBeenCalled();
    expect(texts(r)).toContain("Hi Ana");
  });

  it("goes straight home when a model already works, and warms up on open and on foreground", async () => {
    const { r, emit, server } = mount();
    server.state.usable = true;
    emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
    await flush();
    expect(texts(r)).toContain("Hi Ana");
    expect(server.state.calls.filter((c) => c === "POST /me/warmup")).toHaveLength(1);
    await act(async () => appState.handlers.forEach((h) => h("active")));
    await flush();
    expect(server.state.calls.filter((c) => c === "POST /me/warmup")).toHaveLength(2);
    await act(async () => appState.handlers.forEach((h) => h("background")));
    expect(server.state.calls.filter((c) => c === "POST /me/warmup")).toHaveLength(2);
  });

  it("does not warm up or load anything while signed out", async () => {
    const { server } = mount();
    await flush();
    expect(server.state.calls).toEqual([]);
  });

  it("saves model, language and agent name in settings, and signs out", async () => {
    const { r, emit, prefs, server, auth } = mount();
    server.state.usable = true;
    emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
    await flush();
    await press(r, "Settings");
    await type(r, "Assistant name", "Sol");
    await press(r, "Português");
    await press(r, "Save");
    expect(prefs.saved).toEqual([{ agentName: "Sol" }]);
    expect(server.state.language).toBe("pt");
    expect(texts(r)).toContain("Saved.");
    await press(r, "Back");
    expect(texts(r)).toContain("Sol is ready when you are.");
    await press(r, "Settings");
    await press(r, "Sign out");
    expect(auth.signOut).toHaveBeenCalled();
    await flush();
    expect(texts(r)).toContain("Sign in to OpenBlah");
  });

  it("declining the consent screen starts no call", async () => {
    const { r, emit, server } = mount();
    server.state.usable = true;
    emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
    await flush();
    await press(r, "Start talking");
    await press(r, "Not now");
    expect(texts(r)).toContain("Hi Ana");
    expect(server.state.calls).not.toContain("POST /me/calls");
  });

  it("offers Sign in with Apple and signs in with it", async () => {
    const { r, auth } = mount();
    await flush();
    await press(r, "Continue with Apple");
    expect(auth.signInWithApple).toHaveBeenCalled();
    await flush();
    expect(texts(r)).toContain("Set up your assistant");
  });

  it("hides Sign in with Apple where it is not available", async () => {
    const { auth } = fakeAuth();
    vi.mocked(auth.appleAvailable).mockResolvedValue(false);
    let r!: ReactTestRenderer;
    const server = fakeServer();
    act(() => {
      r = create(
        createElement(AppRoot, {
          auth,
          api: server.api,
          client: server.client,
          prefs: fakePrefs(),
        }),
      );
    });
    await flush();
    expect(texts(r)).toContain("Sign in to OpenBlah");
    expect(
      r.root.findAll(
        (n) =>
          (n.type as unknown) === "Pressable" &&
          n.props.accessibilityLabel === "Continue with Apple",
      ),
    ).toHaveLength(0);
  });

  it("recognises an invite universal link instead of treating it as a sign-in link", async () => {
    linking.initial = "https://openblah.web.app/j/abcDEF123456";
    const { r, emit, server, auth } = mount();
    server.state.usable = true;
    emit({ uid: "u1", email: "ana@example.com", displayName: "Ana" });
    await flush();
    expect(texts(r).join(" ")).toContain("You opened an invite link");
    expect(auth.completeEmailLink).not.toHaveBeenCalled();
  });
});
