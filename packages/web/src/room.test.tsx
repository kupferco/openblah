import { describe, expect, it, vi } from "vitest";
import { act, create } from "react-test-renderer";
import { createElement } from "react";
import { OpenBlahClient, type RoomLike } from "@openblah/core";
import { OpenBlahProvider } from "@openblah/core/react";
import { OpenBlahRoom } from "./room.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(extra: Record<string, unknown> = {}) {
  const handlers = new Map<string, Set<() => void>>();
  const room = {
    state: "disconnected",
    localParticipant: {
      identity: "me",
      name: "Maria",
      isLocal: true,
      isAgent: false,
      isSpeaking: false,
      isMicrophoneEnabled: true,
      setMicrophoneEnabled: vi.fn(async () => {}),
    },
    remoteParticipants: new Map(),
    connect: vi.fn(async () => {
      room.state = "connected";
    }),
    disconnect: vi.fn(async () => {}),
    on: vi.fn((e: string, h: () => void) => {
      (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(h);
      return room;
    }),
    off: vi.fn(),
  };
  const client = new OpenBlahClient({ createRoom: () => room as unknown as RoomLike });
  let r!: ReturnType<typeof create>;
  act(() => {
    r = create(
      createElement(
        OpenBlahProvider,
        { client },
        createElement(OpenBlahRoom, { serverUrl: "wss://x", token: "t", ...extra }),
      ),
    );
  });
  return r;
}

describe("<OpenBlahRoom /> (web)", () => {
  it("shows a Join button when autoJoin is off, themed and relabelled", () => {
    const r = mount({
      autoJoin: false,
      labels: { join: "Entrar" },
      theme: { accent: "#ff0000" },
    });
    const button = r.root.findByType("button");
    expect(button.children).toEqual(["Entrar"]);
    expect((button.props.style as { background: string }).background).toBe("#ff0000");
  });

  it("joins and shows the participants and the mute button", async () => {
    const r = mount();
    await act(async () => {});
    const text = JSON.stringify(r.toJSON());
    expect(text).toContain("Maria");
    expect(text).toContain("Mute");
  });

  it("hides parts", async () => {
    const r = mount({ hide: ["mute", "participants"] });
    await act(async () => {});
    const text = JSON.stringify(r.toJSON());
    expect(text).not.toContain("Maria");
    expect(text).not.toContain('"Mute"');
  });
});
