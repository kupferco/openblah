# Build from the repo root:  docker build -f packages/server/Dockerfile -t openblah-server .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/server/package.json packages/server/
RUN pnpm install --frozen-lockfile --filter @openblah/server...
COPY packages/server packages/server
RUN pnpm --filter @openblah/server build \
 && pnpm --filter @openblah/server deploy --prod /out

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/package.json ./
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
