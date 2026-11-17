import {
  cli,
  defineAgent,
  type JobContext,
  type JobProcess,
  ServerOptions,
  type tts,
  voice,
} from "@livekit/agents";
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
import { openMcpRoom, parseMcpConfig, type ActionLogEntry, type McpRoom } from "./mcp/index.js";
import { defaultProviders } from "./providers/index.js";

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
    const cfg = configFromEnv();
    const models = ctx.proc.userData.models as Models;
    await ctx.connect();
    const roomKeys = await fetchRoomKeys(ctx.room.name ?? "");
    const providers = defaultProviders(process.env, roomKeys?.keys);
    const encoder = new TextEncoder();
    const publish = (topic: string, payload: object) =>
      ctx.room.localParticipant?.publishData(encoder.encode(JSON.stringify(payload)), {
        reliable: true,
        topic,
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
    const agent = new DirectAgent(cfg, providers.tts, mcp?.tools);
    const options = buildSessionOptions(providers, models.vad, createTurnDetector());
    agent.bindTts(options.tts as tts.TTS);
    const session = new voice.AgentSession(options);
    live.session = session;
    attachLatencyLogging(session, agent, ctx.room.name);
    await session.start({ agent, room: ctx.room });
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
    session.generateReply({
      instructions: `Greet the person briefly as ${cfg.agentName} and ask how you can help.`,
    });
  },
});

if (process.argv[1] === import.meta.filename) {
  cli.runApp(
    new ServerOptions({
      agent: import.meta.filename,
      agentName: configFromEnv().dispatchName,
    }),
  );
}
