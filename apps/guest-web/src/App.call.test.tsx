import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ status: "connected", disconnect: vi.fn(async () => {}) }));
vi.mock("@openblah/web/react", () => ({
  useInviteJoin: () => ({ preview: null, error: null, joining: false, join: vi.fn() }),
  useRoom: () => ({ status: state.status, disconnect: state.disconnect }),
  useParticipants: () => [
    {
      identity: "me",
      name: "Sam",
      isLocal: true,
      isAgent: false,
      isMuted: false,
      isSpeaking: false,
    },
    {
      identity: "ag",
      name: "Blah",
      isLocal: false,
      isAgent: true,
      isMuted: false,
      isSpeaking: true,
    },
  ],
  useAgentState: () => "speaking",
  useMute: () => ({ muted: false, toggle: vi.fn() }),
}));

import { App } from "./App.js";

const props = {
  token: "tok",
  support: { ok: true },
  startMic: async () => ({ stop() {} }),
  checkHistory: async () => true,
  historyUrl: (t: string) => `/j/${t}/history`,
};
const text = (r: ReturnType<typeof create>) => JSON.stringify(r.toJSON());

describe("guest page in the call", () => {
  it("shows participants, agent state, mute and leave only (no agent controls), then the ended state with history", async () => {
    let r!: ReturnType<typeof create>;
    await act(async () => void (r = create(<App {...props} />)));
    const t = text(r);
    expect(t).toContain("Sam");
    expect(t).toContain("(AI)");
    expect(t).toContain("speaking");
    const buttons = r.root.findAllByType("button").map((b) => b.props.children);
    expect(buttons).toEqual(["Mute", "Leave"]);

    state.status = "disconnected";
    await act(async () => r.update(<App {...props} />));
    expect(text(r)).toContain("The call has ended");
    expect(text(r)).toContain("View call history");
  });
});
