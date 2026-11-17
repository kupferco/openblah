# Spike image for the TypeScript worker (T5 will add the production one).
# Build from the repo root: docker build -f spikes/measure/ts.Dockerfile -t openblah-agent-ts .
FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agent packages/agent
# Install only the agent package, build, then bake the model files in.
RUN pnpm install --frozen-lockfile --filter @openblah/agent... \
 && pnpm --filter @openblah/agent build \
 && cd packages/agent && node dist/worker.js download-files
WORKDIR /app/packages/agent
CMD ["node", "dist/worker.js", "start"]
