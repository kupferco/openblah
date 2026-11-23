import { createServer, get as httpGet } from "node:http";
import {
  cli,
  defineAgent,
  type JobContext,
  type JobProcess,
  ServerOptions,
  type tts,
  voice,
} from "@livekit/agents";
import { RoomEvent, ParticipantKind } from "@livekit/rtc-node";
import { configFromEnv } from "./config.js";
import { idleProcessesFromEnv, pruneInferenceRunners } from "./inference.js";
import { writeLog } from "./latency.js";
import {
  attachLatencyLogging,
  buildSessionOptions,
  createTurnDetector,
  DirectAgent,
  loadModels,
} from "./pipeline.js";
import {
  fetchMcpToken,
  fetchRoomKeys,
  lastHumanLeft,
  reportAgentOff,
  reportUsageLog,
  UsageCollector,
} from "./keys.js";
import {
  connectMcp,
  openMcpRoom,
  parseMcpConfig,
  type ActionLogEntry,
  type McpRoom,
} from "./mcp/index.js";
import { languageFromMetadata, SETTINGS_INSTRUCTIONS, settingsTools } from "./settings.js";
import { parseRoomProviders, providersFromLevels, withRoomKeys } from "./providers/index.js";
import {
  agentNameFromMetadata,
  AI_PAUSED_ATTRIBUTE,
  CONTROL_TOPIC,
  hostIdentityFromMetadata,
  parseControlMessage,
  RoomControl,
} from "./room-control.js";

type Models = Awaited<ReturnType<typeof loadModels>>;

/**
 * LiveKit Agents entry point. The server dispatches this worker into a room
 * (`POST /v1/rooms/:id/agent`); it runs STT -> LLM -> TTS for one human.
 * Agent state (listening / thinking / speaking) is published by LiveKit as the
 * `lk.agent.state` participant attribute, which `useAgentState` reads.
 */
export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.models = await loadModels();
  },
  entry: async (ctx: JobContext) => {
    const env = configFromEnv();
    const models = ctx.proc.userData.models as Models;
    await ctx.connect();
    const roomKeys = await fetchRoomKeys(ctx.room.name ?? "");
    // The server resolves room > user/product > server default and puts the result in the job metadata,
    // so `room` here is that result; the worker's own environment is only the last fallback.
    const providers = providersFromLevels(
      { room: parseRoomProviders(ctx.job.metadata) },
      withRoomKeys(process.env, roomKeys?.keys),
    );
    const encoder = new TextEncoder();
    const publish = (topic: string, payload: object) =>
      ctx.room.localParticipant?.publishData(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic,
      });
    // The room's own agent name wins over the environment default (Q1).
    const cfg = { ...env, agentName: agentNameFromMetadata(ctx.room.metadata, env.agentName) };
    const control: RoomControl = new RoomControl({
      agentName: cfg.agentName,
      hostIdentity: hostIdentityFromMetadata(ctx.room.metadata),
      getLanguage: () => directAgent.language,
    });
    const live: { session?: voice.AgentSession; userTurns: number } = { userTurns: 0 };
    const mcpConfig = parseMcpConfig(ctx.job.metadata);
    let mcp: McpRoom | undefined;
    if (mcpConfig) {
      mcp = await openMcpRoom({
        roomId: ctx.room.name ?? "",
        config: mcpConfig,
        provider: providers.llm,
        fetchToken: (ownerId, connectionId, refresh) =>
          fetchMcpToken(ctx.room.name ?? "", ownerId, connectionId, refresh),
        // The action log goes to the structured log (with confirmation evidence).
        log: { record: (e: ActionLogEntry) => writeLog({ event: "mcp_action", ...e }) },
        hooks: {
          // Direct mode: the one human in the room.
          currentSpeaker: () => [...ctx.room.remoteParticipants.values()][0]?.identity,
          sayHold: () => void live.session?.say("One moment."),
          setWorking: (working, label) => publish("openblah.working", { working, label }),
          showNote: (note) => publish("openblah.note", note),
          userTurnCount: () => live.userTurns,
          showApproval: (req) => publish("openblah.approval", { type: "request", ...req }),
          resolveApproval: (id, status) =>
            publish("openblah.approval", { type: "resolved", id, status }),
          announce: (text) => void live.session?.say(text),
        },
      });
      const decoder = new TextDecoder();
      ctx.room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        void mcp
          ?.handleData({ topic, payload: decoder.decode(payload), sender: participant?.identity })
          .catch((err) =>
            console.error(JSON.stringify({ event: "approval_failed", err: String(err) })),
          );
      });
      ctx.addShutdownCallback(async () => mcp?.close());
    }
    // The settings tool (model, language, name) lives on the OpenBlah server; reach it with the agent secret.
    let settings: Awaited<ReturnType<typeof connectMcp>> | undefined;
    const serverUrl = process.env.OPENBLAH_SERVER_URL;
    if (serverUrl && process.env.OPENBLAH_AGENT_SECRET) {
      try {
        settings = await connectMcp(
          `${serverUrl.replace(/\/$/, "")}/mcp/settings`,
          process.env.OPENBLAH_AGENT_SECRET,
        );
        ctx.addShutdownCallback(async () => settings?.close());
      } catch {
        writeLog({ event: "settings_tool_unavailable", roomId: ctx.room.name });
      }
    }
    const directAgent: DirectAgent = new DirectAgent(
      cfg,
      providers.tts,
      {
        ...control.tools(),
        ...mcp?.tools,
        ...(settings
          ? settingsTools({
              roomId: ctx.room.name ?? "",
              connection: settings,
              currentSpeaker: () => [...ctx.room.remoteParticipants.values()][0]?.identity,
              turn: () => directAgent.turn,
            })
          : {}),
      },
      settings ? SETTINGS_INSTRUCTIONS : undefined,
    );
    const options = buildSessionOptions(providers, models.vad, createTurnDetector());
    directAgent.bindTts(options.tts as tts.TTS);
    directAgent.lockLanguage(languageFromMetadata(ctx.job.metadata));
    const session = new voice.AgentSession(options);
    live.session = session;
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) live.userTurns += 1;
    });
    attachLatencyLogging(session, directAgent, ctx.room.name);
    await session.start({ agent: directAgent, room: ctx.room });
    if (roomKeys) {
      // The server keeps the usage log and enforces the caps (room length, idle, monthly
      // minutes, the £50 hosted-key cap and the trial); the worker only reports and stops.
      const collector = new UsageCollector();
      for (const p of ctx.room.remoteParticipants.values()) collector.participantJoined(p.identity);
      ctx.room.on(RoomEvent.ParticipantConnected, (p) => collector.participantJoined(p.identity));
      ctx.room.on(RoomEvent.ParticipantDisconnected, (p) => collector.participantLeft(p.identity));
      ctx.room.on(RoomEvent.ActiveSpeakersChanged, (s) => s.length > 0 && collector.activity());
      session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) =>
        collector.agentState(ev.newState),
      );
      session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) =>
        collector.metrics(
          ev.metrics,
          [...ctx.room.remoteParticipants.values()][0]?.identity ?? "session",
        ),
      );
      const send = async () => {
        const verdict = await reportUsageLog(ctx.room.name ?? "", collector.take());
        if (!verdict.available) {
          writeLog({ event: "agent_stopped", roomId: ctx.room.name, reason: verdict.stop });
          void session.close();
        }
      };
      const timer = setInterval(() => void send().catch(() => {}), 10_000);
      ctx.addShutdownCallback(async () => {
        clearInterval(timer);
        await reportUsageLog(ctx.room.name ?? "", collector.take()).catch(() => {});
      });
    }
    writeLog({ event: "agent_joined", roomId: ctx.room.name });

    const local = ctx.room.localParticipant;
    let lastSpeech: { waitForPlayout(): Promise<void> } | undefined;
    control.bind({
      say: (text) => {
        lastSpeech = session.say(text);
      },
      setListening: (enabled) => session.input.setAudioEnabled(enabled),
      publishPaused: (paused) => {
        void local?.setAttributes({ [AI_PAUSED_ATTRIBUTE]: String(paused) });
      },
      sendTo: (identity, msg) => {
        void local?.publishData(new TextEncoder().encode(JSON.stringify(msg)), {
          reliable: true,
          topic: CONTROL_TOPIC,
          destination_identities: [identity],
        });
      },
      agentOff: () => void reportAgentOff(ctx.room.name ?? ""),
      leave: () => {
        void (async () => {
          await lastSpeech?.waitForPlayout().catch(() => undefined);
          ctx.shutdown("asked to leave");
        })();
      },
    });
    ctx.room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (topic !== CONTROL_TOPIC) return;
      const msg = parseControlMessage(payload);
      if (msg) control.onControlMessage(participant ?? null, msg);
    });
    // The agent never stays in an empty room: it leaves with the last human (no audio, no cost).
    ctx.room.on(RoomEvent.ParticipantDisconnected, () => {
      const others = [...ctx.room.remoteParticipants.values()].map((p) => ({
        isAgent: p.kind === ParticipantKind.AGENT,
      }));
      if (lastHumanLeft(others)) {
        writeLog({ event: "agent_left", roomId: ctx.room.name, reason: "last human left" });
        ctx.shutdown("last human left");
      }
    });
    ctx.room.on(RoomEvent.ParticipantConnected, (p) => {
      writeLog({ event: "participant_joined", roomId: ctx.room.name, paused: control.paused });
      control.onParticipantJoined({
        identity: p.identity,
        name: p.name,
        isAgent: p.kind === ParticipantKind.AGENT,
      });
    });
    control.announceEntry();
  },
});

if (process.argv[1] === import.meta.filename) {
  // Cloud Run requires something to listen on $PORT within seconds of start. LiveKit's own
  // HTTP server only opens after the models and the LiveKit connection are up, which can
  // take longer (or never happen if LiveKit is unreachable), so the revision would be
  // marked failed. Listen right away; a request here also wakes the instance (warm-up).
  // LiveKit's built-in server moves to an internal port.
  //
  // Answering here says the instance is up, not that it can take a job: that is `/ready`, which
  // passes on LiveKit's own health check (200 once the worker is registered, 503 before). The
  // server waits on it before dispatching, because LiveKit does not hold a dispatch for a worker
  // that registers later.
  const port = Number(process.env.PORT ?? 8081);
  if (process.env.PORT && process.argv.includes("start")) {
    createServer((req, res) => {
      if (req.url === "/ready") {
        const check = httpGet(
          { host: "127.0.0.1", port: 8081, path: "/", timeout: 2_000 },
          (lk) => {
            res.writeHead(lk.statusCode === 200 ? 200 : 503, { "content-type": "text/plain" });
            res.end(lk.statusCode === 200 ? "ready" : "starting");
            lk.resume();
          },
        );
        check.on("timeout", () => check.destroy());
        check.on("error", () => {
          // LiveKit's server is not listening yet: still starting.
          if (res.headersSent) return;
          res.writeHead(503, { "content-type": "text/plain" });
          res.end("starting");
        });
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    }).listen(port, "0.0.0.0");
  }
  // Memory: load only the turn detector we use, and keep one warm job process.
  pruneInferenceRunners();
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      agentName: configFromEnv().dispatchName,
      host: "127.0.0.1",
      port: process.env.PORT && process.argv.includes("start") ? 8081 : port,
      numIdleProcesses: idleProcessesFromEnv(),
    }),
  );
}
