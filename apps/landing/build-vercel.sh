#!/bin/sh
# Vercel build for the "openblah" project (root directory apps/landing).
# Builds the landing page, then the guest page (apps/guest-web) and serves it under /j/*
# (see vercel.json). Needs "Include source files outside of the Root Directory" (Vercel default).
# cleanUrls is off on purpose: with it on, the rewrite to /guest/index.html 404s on Vercel.
set -eu
cd "$(dirname "$0")"
npm run build

# Fake invite server (token "demo") on preview deployments only, never production.
if [ "${VERCEL_ENV:-}" = "preview" ]; then MOCK=1; else MOCK=""; fi

cd ../..
# Pin the pnpm that wrote the lockfile; the pnpm preinstalled on Vercel may be another major.
PNPM="npx --yes pnpm@9.15.9"
$PNPM install --frozen-lockfile --filter @openblah/guest-web...
VITE_MOCK_SERVER="$MOCK" $PNPM --filter @openblah/guest-web build
rm -rf apps/landing/dist/guest
cp -r apps/guest-web/dist apps/landing/dist/guest

# Fail the build rather than ship a deploy where /j/* 404s.
if [ ! -f apps/landing/dist/guest/index.html ]; then
  echo "build-vercel.sh: apps/landing/dist/guest/index.html is missing" >&2
  exit 1
fi
if [ ! -f apps/landing/dist/index.html ]; then
  echo "build-vercel.sh: apps/landing/dist/index.html is missing" >&2
  exit 1
fi

# Design mock (apps/mock, static) served under /mock/. Screenshots are not served.
rm -rf apps/landing/dist/mock
mkdir -p apps/landing/dist/mock
for f in apps/mock/*; do
  case "$(basename "$f")" in screenshots|package.json|README.md) continue ;; esac
  cp -r "$f" apps/landing/dist/mock/
done
if [ ! -f apps/landing/dist/mock/index.html ]; then
  echo "build-vercel.sh: apps/landing/dist/mock/index.html is missing" >&2
  exit 1
fi
