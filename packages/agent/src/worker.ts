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
import { writeLog } from "./latency.js";
import {
  attachLatencyLogging,
  buildSessionOptions,
  createTurnDetector,
  DirectAgent,
  loadModels,
} from "./pipeline.js";
import { fetchRoomKeys, reportUsage, UsageMeter } from "./keys.js";
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
    const live: { session?: voice.AgentSession } = {};
    const mcpConfig = parseMcpConfig(ctx.job.metadata);
    let mcp: McpRoom | undefined;
    if (mcpConfig) {
      mcp = await openMcpRoom({
        roomId: ctx.room.name ?? "",
        config: mcpConfig,
        provider: providers.llm,
        // The action log goes to the structured log; the room store comes with T13.
        log: { record: (e: ActionLogEntry) => writeLog({ event: "mcp_action", ...e }) },
        hooks: {
          // Direct mode: the one human in the room.
          currentSpeaker: () => [...ctx.room.remoteParticipants.values()][0]?.identity,
          sayHold: () => void live.session?.say("One moment."),
          setWorking: (working, label) => publish("openblah.working", { working, label }),
          showNote: (note) => publish("openblah.note", note),
        },
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
    attachLatencyLogging(session, directAgent, ctx.room.name);
    await session.start({ agent: directAgent, room: ctx.room });
    if (roomKeys?.mode === "trial") {
      // The server counts the trial; the worker only reports seconds and stops when it is used up.
      const meter = new UsageMeter();
      session.on(voice.AgentSessionEventTypes.AgentStateChanged, (ev) =>
        meter.setState(ev.newState),
      );
      const timer = setInterval(() => {
        void reportUsage(ctx.room.name ?? "", meter.take()).then((more) => {
          if (!more) void session.close();
        });
      }, 10_000);
      ctx.addShutdownCallback(async () => {
        clearInterval(timer);
        await reportUsage(ctx.room.name ?? "", meter.take());
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
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      agentName: configFromEnv().dispatchName,
      // Cloud Run sends requests (the server's warm-up) to $PORT; the worker's
      // built-in HTTP server answers them and the request wakes the instance.
      host: "0.0.0.0",
      port: Number(process.env.PORT ?? 8081),
    }),
  );
}
