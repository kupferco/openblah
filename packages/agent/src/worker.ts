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
import { openMcpRoom, parseMcpConfig, type ActionLogEntry, type McpRoom } from "./mcp/index.js";
import { defaultProviders } from "./providers/index.js";
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
    // The room's own agent name wins over the environment default (Q1).
    const cfg = { ...env, agentName: agentNameFromMetadata(ctx.room.metadata, env.agentName) };
    const providers = defaultProviders();
    const control: RoomControl = new RoomControl({
      agentName: cfg.agentName,
      hostIdentity: hostIdentityFromMetadata(ctx.room.metadata),
      getLanguage: () => directAgent.language,
    });
    const live: { session?: voice.AgentSession } = {};
    const mcpConfig = parseMcpConfig(ctx.job.metadata);
    let mcp: McpRoom | undefined;
    if (mcpConfig) {
      const encoder = new TextEncoder();
      const publish = (topic: string, payload: object) =>
        ctx.room.localParticipant?.publishData(encoder.encode(JSON.stringify(payload)), {
          reliable: true,
          topic,
        });
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
    const directAgent = new DirectAgent(cfg, providers.tts, { ...control.tools(), ...mcp?.tools });
    const options = buildSessionOptions(providers, models.vad, createTurnDetector());
    directAgent.bindTts(options.tts as tts.TTS);
    const session = new voice.AgentSession(options);
    live.session = session;
    attachLatencyLogging(session, directAgent, ctx.room.name);
    await session.start({ agent: directAgent, room: ctx.room });
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
    }),
  );
}
