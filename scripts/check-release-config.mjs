#!/usr/bin/env node
/* global process, console, URL */
// Lints the iOS release config (T26): app.json, eas.json, firebase.json and the universal-link files.
//   node scripts/check-release-config.mjs          the free-account build: needs no Apple team,
//                                                  App Store Connect id or EAS submit secrets
//   node scripts/check-release-config.mjs --paid   also checks the paid-account pieces (universal links,
//                                                  Sign in with Apple, eas submit), structure only
//   node scripts/check-release-config.mjs --paid --release   also needs the real Apple values; prints
//                                                  a ::viber-manual:: marker while placeholders remain
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createRequire } from "node:module";

const DOMAIN = "openblah.web.app";

/** Returns { errors, placeholders } for a repo rooted at `root`. */
export function checkReleaseConfig(root, { paid = false } = {}) {
  const errors = [];
  const placeholders = [];
  const read = (p) => {
    try {
      return JSON.parse(readFileSync(join(root, p), "utf8"));
    } catch (e) {
      errors.push(`${p}: ${e.message}`);
      return null;
    }
  };
  const ph = (where, value) => {
    if (
      typeof value === "string" &&
      /^[A-Z0-9_]+$/.test(value.split(".")[0]) &&
      /APPLE_TEAM_ID|FINGERPRINT|APP_STORE_CONNECT/.test(value)
    ) {
      placeholders.push({ where, value });
    }
  };

  const app = read("apps/app/app.json")?.expo;
  const bundle = app?.ios?.bundleIdentifier;
  if (app) {
    if (!bundle) errors.push("app.json: ios.bundleIdentifier is missing");
    if (!app.scheme) errors.push("app.json: scheme is missing (email-link sign-in needs it)");
    // The default build must sign with a free personal team: no paid-only capabilities.
    if (app.ios?.associatedDomains)
      errors.push(
        "app.json: ios.associatedDomains needs the paid account; set it in app.config.js",
      );
    if (app.ios?.usesAppleSignIn)
      errors.push("app.json: ios.usesAppleSignIn needs the paid account; set it in app.config.js");
    if (app.plugins?.includes("expo-apple-authentication"))
      errors.push(
        "app.json: expo-apple-authentication needs the paid account; add it in app.config.js",
      );
    for (const f of [app.icon, app.splash?.image, app.android?.adaptiveIcon?.foregroundImage]) {
      try {
        readFileSync(join(root, "apps/app", f));
      } catch {
        errors.push(`app.json: asset ${f} is missing`);
      }
    }
  }

  const fb = read("firebase.json")?.hosting;
  if (fb) {
    if (fb.public !== "hosting/public")
      errors.push("firebase.json: hosting.public must be hosting/public");
    if (!(fb.rewrites ?? []).some((r) => r.source === "/j/**"))
      errors.push("firebase.json: /j/** rewrite is missing");
  }
  try {
    const page = readFileSync(join(root, "hosting/public/signin/index.html"), "utf8");
    if (!page.includes("openblah://signin?link="))
      errors.push("hosting/public/signin/index.html must redirect to openblah://signin?link=");
  } catch (e) {
    errors.push(`hosting/public/signin/index.html: ${e.message}`);
  }

  const eas = read("apps/app/eas.json");
  if (eas) {
    for (const k of ["development", "preview", "production"])
      if (!eas.build?.[k]) errors.push(`eas.json: build profile ${k} is missing`);
    if (eas.submit)
      errors.push("eas.json: submit needs the paid account; keep it in eas.paid.json");
  }

  if (paid) {
    const cfg = appConfig(root, { EXPO_PUBLIC_OPENBLAH_PAID_APPLE: "1" });
    if (!cfg.ios?.associatedDomains?.includes(`applinks:${DOMAIN}`))
      errors.push(`app.config.js (paid): ios.associatedDomains must include applinks:${DOMAIN}`);
    if (!cfg.ios?.usesAppleSignIn)
      errors.push("app.config.js (paid): usesAppleSignIn must be true");
    if (!cfg.plugins?.includes("expo-apple-authentication"))
      errors.push("app.config.js (paid): the expo-apple-authentication plugin is missing");
    const link = cfg.android?.intentFilters?.some((i) =>
      i.data?.some((d) => d.host === DOMAIN && d.pathPrefix === "/j/"),
    );
    if (!link) errors.push(`app.config.js (paid): android intent filter for /j/ is missing`);

    const aasa = read("hosting/public/.well-known/apple-app-site-association");
    if (aasa && bundle) {
      const details = aasa.applinks?.details ?? [];
      const ids = details.flatMap((d) => d.appIDs ?? []);
      if (!ids.length) errors.push("AASA: applinks.details[].appIDs is empty");
      for (const id of ids) {
        if (!id.endsWith(`.${bundle}`))
          errors.push(`AASA: appID ${id} does not end with .${bundle}`);
        ph("AASA appID", id);
      }
      const paths = details.flatMap((d) => (d.components ?? []).map((c) => c["/"]));
      if (!paths.includes("/j/*")) errors.push("AASA: no component for /j/*");
    }
    const links = read("hosting/public/.well-known/assetlinks.json");
    if (links) {
      const t = links[0]?.target;
      if (t?.package_name !== app?.android?.package)
        errors.push("assetlinks.json: package_name does not match app.json android.package");
      for (const f of t?.sha256_cert_fingerprints ?? []) ph("assetlinks fingerprint", f);
    }
    const paidEas = read("apps/app/eas.paid.json");
    const ios = paidEas?.submit?.production?.ios;
    ph("eas.paid.json ascAppId", ios?.ascAppId);
    ph("eas.paid.json appleTeamId", ios?.appleTeamId);
  }
  return { errors, placeholders };
}

/** Evaluates apps/app/app.config.js with the given env, the way Expo does. */
function appConfig(root, env) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const file = join(root, "apps/app/app.config.js");
    const fn = createRequire(import.meta.url)(file);
    delete createRequire(import.meta.url).cache?.[file];
    const base = JSON.parse(readFileSync(join(root, "apps/app/app.json"), "utf8")).expo;
    return fn({ config: base });
  } finally {
    for (const k of Object.keys(env)) {
      if (k in saved) process.env[k] = saved[k];
      else delete process.env[k];
    }
  }
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const release = process.argv.includes("--release");
  const paid = release || process.argv.includes("--paid");
  const { errors, placeholders } = checkReleaseConfig(root, { paid });
  if (errors.length) {
    console.error(errors.map((e) => `- ${e}`).join("\n"));
    process.exit(1);
  }
  if (release && placeholders.length) {
    const marker = {
      reason: `the release config still has placeholders (${[...new Set(placeholders.map((p) => p.value))].join(", ")}) that only the Apple account owner can fill in`,
      action:
        "After enrolling in the Apple Developer Program, replace the placeholders on the feat/t26-standalone-app-part-3 branch (or main once merged) as docs/release-ios.md describes",
      commands: [
        "sed -i 's/APPLE_TEAM_ID/<your 10-character team id>/g' hosting/public/.well-known/apple-app-site-association apps/app/eas.paid.json",
        "sed -i 's/APP_STORE_CONNECT_APP_ID/<numeric app id>/' apps/app/eas.paid.json",
        "node scripts/check-release-config.mjs --paid --release",
      ],
      verify: "node scripts/check-release-config.mjs --paid --release prints 'release config ok'",
    };
    console.log(`::viber-manual::${JSON.stringify(marker)}`);
    process.exit(1);
  }
  console.log(
    release
      ? "release config ok"
      : "config ok (free-account build; paid Apple placeholders are only checked with --paid --release)",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
