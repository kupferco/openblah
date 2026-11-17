#!/bin/sh
# Vercel build for the "openblah" project (root directory apps/landing).
# Builds the landing page, then the guest page (apps/guest-web) and serves it under /j/*
# (see vercel.json). Needs "Include source files outside of the Root Directory" (Vercel default).
set -eu
cd "$(dirname "$0")"
npm run build

# Fake invite server (token "demo") on preview deployments only, never production.
if [ "${VERCEL_ENV:-}" = "preview" ]; then MOCK=1; else MOCK=""; fi

cd ../..
corepack enable
pnpm install --frozen-lockfile --filter @openblah/guest-web...
VITE_MOCK_SERVER="$MOCK" pnpm --filter @openblah/guest-web build
rm -rf apps/landing/dist/guest
cp -r apps/guest-web/dist apps/landing/dist/guest
