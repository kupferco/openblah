# Build from the repo root:  docker build -f packages/agent/Dockerfile -t openblah-agent .
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/agent/package.json packages/agent/
RUN pnpm install --frozen-lockfile --filter @openblah/agent...
COPY packages/agent packages/agent
RUN pnpm --filter @openblah/agent build \
 && pnpm --filter @openblah/agent deploy --prod /out

# glibc image: the native LiveKit/onnx modules do not run on alpine (musl).
FROM node:22-slim
# The native LiveKit client (rtc-node) verifies TLS against the OS CA store, which the slim image
# lacks; without it joining a room fails with "no native root CA certificates found". (Node's own
# HTTPS bundles its CAs, so registering the worker still works, which hides the problem.)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./
# The LiveKit plugins (JS) cache model files under ~/.cache/huggingface and ignore HF_HOME (the
# build log of the failed deploy shows them written to /home/node/.cache/huggingface even with
# HF_HOME set). Build and runtime must both run as `node` with the same HOME, so pin HOME and
# check that exact path.
ENV HOME=/home/node
RUN mkdir -p "$HOME/.cache/huggingface" && chown -R node:node /app "$HOME"
USER node
# Bake the VAD and turn-detector models into the image so a cold start does not download them.
RUN node dist/worker.js download-files
# Fail the build if the turn-detector model is missing from the path the worker reads at runtime.
RUN find "$HOME/.cache/huggingface" -name 'model_q8.onnx' | grep -q . \
 || { echo "turn-detector model_q8.onnx missing under $HOME/.cache/huggingface" >&2; exit 1; }
EXPOSE 8080
CMD ["node", "dist/worker.js", "start"]
