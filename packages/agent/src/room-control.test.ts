import { describe, expect, it, vi } from "vitest";
import {
  agentNameFromMetadata,
  hostIdentityFromMetadata,
  parseControlMessage,
  RoomControl,
  type RoomPort,
} from "./room-control.js";

function setup(opts: { host?: string; timeout?: number } = {}) {
  const port = {
    say: vi.fn<RoomPort["say"]>(),
    setListening: vi.fn<RoomPort["setListening"]>(),
    publishPaused: vi.fn<RoomPort["publishPaused"]>(),
    sendTo: vi.fn<RoomPort["sendTo"]>(),
    leave: vi.fn<RoomPort["leave"]>(),
    agentOff: vi.fn<NonNullable<RoomPort["agentOff"]>>(),
  };
  const control = new RoomControl({
    agentName: "Blah",
    hostIdentity: "host" in opts ? opts.host : "dani",
    inviteTimeoutMs: opts.timeout,
    newId: () => "req1",
  });
  control.bind(port);
  return { control, port };
}

type Exec = (args: unknown, ctx: unknown) => Promise<string>;
const run = (tool: unknown, args: unknown) => (tool as { execute: Exec }).execute(args, {});

describe("announcements", () => {
  it("says it is here and listening on entry, with the room's agent name", () => {
    const { control, port } = setup();
    control.announceEntry();
    expect(port.say).toHaveBeenCalledWith("Blah is here and listening.");
  });

  it("says it again when someone joins, not for itself", () => {
    const { control, port } = setup();
    control.onParticipantJoined({ identity: "g1", name: "Mom" });
    expect(port.say).toHaveBeenLastCalledWith("Mom joined. Blah is here and listening.");
    control.onParticipantJoined({ identity: "agent", isAgent: true });
    expect(port.say).toHaveBeenCalledTimes(1);
  });

  it("tells a joiner when listening is paused", () => {
    const { control, port } = setup();
    control.pause("g1");
    port.say.mockClear();
    control.onParticipantJoined({ identity: "g2", name: "Ana" });
    expect(port.say).toHaveBeenCalledWith("Ana joined. Blah is paused and not listening.");
  });
});

describe("pause", () => {
  it("stops listening for everyone and shows it", () => {
    const { control, port } = setup();
    control.onControlMessage({ identity: "g1" }, { type: "pause_ai", paused: true });
    expect(control.paused).toBe(true);
    expect(port.setListening).toHaveBeenCalledWith(false);
    expect(port.publishPaused).toHaveBeenCalledWith(true);
    expect(port.say).toHaveBeenCalledTimes(1);
  });

  it("is idempotent", () => {
    const { control, port } = setup();
    control.pause("a");
    control.pause("b");
    expect(port.setListening).toHaveBeenCalledTimes(1);
  });

  it("lets only the host or the person who paused resume", () => {
    const { control, port } = setup();
    control.onControlMessage({ identity: "g1" }, { type: "pause_ai", paused: true });
    control.onControlMessage({ identity: "g2" }, { type: "pause_ai", paused: false });
    expect(control.paused).toBe(true);
    control.onControlMessage({ identity: "g1" }, { type: "pause_ai", paused: false });
    expect(control.paused).toBe(false);
    expect(port.setListening).toHaveBeenLastCalledWith(true);
    expect(port.publishPaused).toHaveBeenLastCalledWith(false);
    control.pause("g1");
    control.onControlMessage({ identity: "dani" }, { type: "pause_ai", paused: false });
    expect(control.paused).toBe(false);
  });

  it("ignores messages without a sender", () => {
    const { control } = setup();
    control.onControlMessage(null, { type: "pause_ai", paused: true });
    expect(control.paused).toBe(false);
  });
});

describe("stop listening or leave by voice", () => {
  it("pauses; only the host can resume", async () => {
    const { control, port } = setup();
    expect(await run(control.tools().stop_listening_or_leave, { action: "pause" })).toMatch(
      /paused/,
    );
    expect(port.setListening).toHaveBeenCalledWith(false);
    control.onControlMessage({ identity: "g1" }, { type: "pause_ai", paused: false });
    expect(control.paused).toBe(true);
    control.onControlMessage({ identity: "dani" }, { type: "pause_ai", paused: false });
    expect(control.paused).toBe(false);
  });

  it("leaves: stops listening, says goodbye, leaves", async () => {
    const { control, port } = setup();
    await run(control.tools().stop_listening_or_leave, { action: "leave" });
    expect(port.setListening).toHaveBeenCalledWith(false);
    expect(port.say).toHaveBeenCalledWith("Okay, Blah is leaving the call.");
    expect(port.leave).toHaveBeenCalled();
    // A voice request to leave puts the room back to agent off on the server.
    expect(port.agentOff).toHaveBeenCalled();
  });

  it("pausing by voice does not turn the room off", async () => {
    const { control, port } = setup();
    await run(control.tools().stop_listening_or_leave, { action: "pause" });
    expect(port.agentOff).not.toHaveBeenCalled();
  });
});

describe("invite_participant tool", () => {
  it("asks the host's app and reports the answer", async () => {
    const { control, port } = setup();
    const result = run(control.tools().invite_participant, { who: "my mother" });
    expect(port.sendTo).toHaveBeenCalledWith("dani", {
      type: "invite_request",
      requestId: "req1",
      who: "my mother",
    });
    control.onControlMessage(
      { identity: "dani" },
      { type: "invite_response", requestId: "req1", status: "sent" },
    );
    expect(await result).toMatch(/shared/);
  });

  it("ignores answers from anyone but the host", async () => {
    vi.useFakeTimers();
    try {
      const { control } = setup({ timeout: 1000 });
      const result = run(control.tools().invite_participant, { who: "Ana" });
      control.onControlMessage(
        { identity: "g1" },
        { type: "invite_response", requestId: "req1", status: "sent" },
      );
      await vi.advanceTimersByTimeAsync(1000);
      expect(await result).toMatch(/did not answer/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a decline, and says so when there is no host", async () => {
    const { control } = setup();
    const result = run(control.tools().invite_participant, { who: "Ana" });
    control.onControlMessage(
      { identity: "dani" },
      { type: "invite_response", requestId: "req1", status: "declined" },
    );
    expect(await result).toMatch(/cancelled/);
    const none = setup({ host: undefined });
    expect(await run(none.control.tools().invite_participant, { who: "x" })).toMatch(
      /not available/,
    );
    expect(none.port.sendTo).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("parses control messages and room metadata", () => {
    expect(parseControlMessage('{"type":"pause_ai","paused":true}')).toEqual({
      type: "pause_ai",
      paused: true,
    });
    expect(parseControlMessage("x")).toBeNull();
    expect(hostIdentityFromMetadata('{"hostUserId":"dani"}')).toBe("dani");
    expect(hostIdentityFromMetadata("")).toBeUndefined();
    expect(agentNameFromMetadata('{"agentName":" Max "}', "Blah")).toBe("Max");
    expect(agentNameFromMetadata(undefined, "Blah")).toBe("Blah");
  });
});
