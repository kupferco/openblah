import { describe, expect, it, vi } from "vitest";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { OpenBlahClient } from "@openblah/web";
import { OpenBlahProvider } from "@openblah/web/react";
import { App, type AppProps } from "./App.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const preview = {
  hostDisplayName: "Alex",
  agent: "on",
  agentName: "Blah",
  consent: { version: "v1", text: "Blah will listen and take notes." },
};

function render(opts: { fetch: typeof fetch } & Partial<AppProps>) {
  const client = new OpenBlahClient({ api: { baseUrl: "https://s/v1", fetch: opts.fetch } });
  const props: AppProps = {
    token: "tok",
    support: { ok: true },
    startMic: vi.fn(async (onState) => (onState("ok"), { stop() {} })),
    checkHistory: async () => false,
    historyUrl: (t) => `/j/${t}/history`,
    ...opts,
  };
  let r!: ReactTestRenderer;
  return (async () => {
    await act(async () => {
      r = create(
        <OpenBlahProvider client={client}>
          <App {...props} />
        </OpenBlahProvider>,
      );
    });
    return r;
  })();
}

const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON());
const json =
  (body: unknown, status = 200) =>
  async () =>
    Response.json(body, { status });

describe("guest page states", () => {
  it("shows a friendly state for an expired, revoked or ended invite", async () => {
    const r = await render({ fetch: json({ error: "invite is not valid" }, 404) as never });
    expect(text(r)).toContain("This link doesn't work");
    expect(text(r)).toContain("expired");
  });

  it("shows a network state when the server cannot be reached", async () => {
    const r = await render({
      fetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as never,
    });
    expect(text(r)).toContain("Can't reach the call server");
  });

  it("shows an unsupported-browser state and never loads the invite", async () => {
    const fetch = vi.fn(json(preview));
    const r = await render({
      fetch: fetch as never,
      support: { ok: false, reason: "No WebRTC." },
    });
    expect(text(r)).toContain("This browser can't join");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a state when there is no token", async () => {
    const r = await render({ fetch: json(preview) as never, token: null });
    expect(text(r)).toContain("No invite link");
  });

  it("needs name, consent and a working mic before Join is enabled", async () => {
    const r = await render({ fetch: json(preview) as never });
    expect(text(r)).toContain("Blah will listen and take notes.");
    const join = () => r.root.findAllByType("button").find((b) => b.props.className === "primary")!;
    expect(join().props.disabled).toBe(true);

    await act(async () =>
      r.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: true } }),
    );
    await act(async () =>
      r.root.findAllByType("input")[0]!.props.onChange({ target: { value: "Sam" } }),
    );
    expect(join().props.disabled).toBe(true); // mic not checked yet

    const check = r.root
      .findAllByType("button")
      .find((b) => b.props.children === "Check my microphone")!;
    await act(async () => check.props.onClick());
    expect(join().props.disabled).toBe(false);
  });

  it("shows how to fix a blocked microphone", async () => {
    const r = await render({
      fetch: json(preview) as never,
      startMic: async (onState) => (onState("blocked"), { stop() {} }),
    });
    const check = r.root
      .findAllByType("button")
      .find((b) => b.props.children === "Check my microphone")!;
    await act(async () => check.props.onClick());
    expect(text(r)).toContain("The microphone is blocked");
  });

  it("does not ask for consent when the room's AI is off", async () => {
    const r = await render({ fetch: json({ ...preview, agent: "off" }) as never });
    expect(r.root.findAllByProps({ type: "checkbox" })).toHaveLength(0);
  });
});
