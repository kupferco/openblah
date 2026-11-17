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
# Bake the VAD and turn-detector models into the image so a cold start does not download them.
RUN node dist/worker.js download-files
USER node
EXPOSE 8080
CMD ["node", "dist/worker.js", "start"]
