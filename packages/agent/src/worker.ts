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
import { attachLatencyLogging, buildSessionOptions, DirectAgent, loadModels } from "./pipeline.js";
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
    const providers = defaultProviders();
    const agent = new DirectAgent(cfg, providers.tts);
    const options = buildSessionOptions(providers, models.vad, models.turnDetector);
    agent.bindTts(options.tts as tts.TTS);
    const session = new voice.AgentSession(options);
    attachLatencyLogging(session, agent, ctx.room.name);
    await session.start({ agent, room: ctx.room });
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
