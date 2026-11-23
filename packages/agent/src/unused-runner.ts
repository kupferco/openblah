import { InferenceRunner } from "@livekit/agents";

/**
 * Stands in for an inference model the agent never calls, so LiveKit's inference
 * process does not load it (see `pruneInferenceRunners`). Loads nothing.
 */
export default class UnusedRunner extends InferenceRunner {
  async initialize(): Promise<void> {}
  async run(): Promise<never> {
    throw new Error("This inference model is not loaded by the OpenBlah agent");
  }
  async close(): Promise<void> {}
}
