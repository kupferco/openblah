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
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./
# The LiveKit plugins cache model files under HF_HOME (default: ~/.cache/huggingface). The build
# step used to run as root (HOME=/root) while the container runs as `node` (HOME=/home/node), so the
# downloaded files were never found at runtime. Pin the cache to a fixed path owned by `node`.
ENV HF_HOME=/app/.cache/huggingface
RUN mkdir -p "$HF_HOME" && chown -R node:node /app
USER node
# Bake the VAD and turn-detector models into the image so a cold start does not download them.
RUN node dist/worker.js download-files
# Fail the build if the turn-detector model is missing from the final image.
RUN find "$HF_HOME" -name 'model_q8.onnx' | grep -q . \
 || { echo "turn-detector model_q8.onnx missing under $HF_HOME" >&2; exit 1; }
EXPOSE 8080
CMD ["node", "dist/worker.js", "start"]
