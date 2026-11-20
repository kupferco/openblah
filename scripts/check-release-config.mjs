#!/usr/bin/env node
/* global process, console, URL */
// Lints the iOS release config (T26): app.json, eas.json, firebase.json and the universal-link files.
//   node scripts/check-release-config.mjs            structure only (runs in tests and CI)
//   node scripts/check-release-config.mjs --release  also needs the owner's real values; prints
//                                                    a ::viber-manual:: marker while placeholders remain
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const DOMAIN = "openblah.web.app";

/** Returns { errors, placeholders } for a repo rooted at `root`. */
export function checkReleaseConfig(root) {
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
    if (!app.ios?.associatedDomains?.includes(`applinks:${DOMAIN}`))
      errors.push(`app.json: ios.associatedDomains must include applinks:${DOMAIN}`);
    if (!app.ios?.usesAppleSignIn) errors.push("app.json: ios.usesAppleSignIn must be true");
    if (!app.plugins?.includes("expo-apple-authentication"))
      errors.push("app.json: the expo-apple-authentication plugin is missing");
    for (const f of [app.icon, app.splash?.image, app.android?.adaptiveIcon?.foregroundImage]) {
      try {
        readFileSync(join(root, "apps/app", f));
      } catch {
        errors.push(`app.json: asset ${f} is missing`);
      }
    }
    const link = app.android?.intentFilters?.some((i) =>
      i.data?.some((d) => d.host === DOMAIN && d.pathPrefix === "/j/"),
    );
    if (!link) errors.push(`app.json: android intent filter for https://${DOMAIN}/j/ is missing`);
  }

  const aasa = read("hosting/public/.well-known/apple-app-site-association");
  if (aasa && bundle) {
    const details = aasa.applinks?.details ?? [];
    const ids = details.flatMap((d) => d.appIDs ?? []);
    if (!ids.length) errors.push("AASA: applinks.details[].appIDs is empty");
    for (const id of ids) {
      if (!id.endsWith(`.${bundle}`)) errors.push(`AASA: appID ${id} does not end with .${bundle}`);
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

  const fb = read("firebase.json")?.hosting;
  if (fb) {
    if (fb.public !== "hosting/public")
      errors.push("firebase.json: hosting.public must be hosting/public");
    const h = (fb.headers ?? []).find(
      (x) => x.source === "/.well-known/apple-app-site-association",
    );
    if (!h?.headers?.some((x) => x.key === "Content-Type" && x.value === "application/json"))
      errors.push("firebase.json: the AASA file must be served as application/json");
    if (!(fb.rewrites ?? []).some((r) => r.source === "/j/**"))
      errors.push("firebase.json: /j/** rewrite is missing");
  }

  const eas = read("apps/app/eas.json");
  if (eas) {
    for (const k of ["development", "preview", "production"])
      if (!eas.build?.[k]) errors.push(`eas.json: build profile ${k} is missing`);
    const ios = eas.submit?.production?.ios;
    ph("eas.json ascAppId", ios?.ascAppId);
    ph("eas.json appleTeamId", ios?.appleTeamId);
  }
  return { errors, placeholders };
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const release = process.argv.includes("--release");
  const { errors, placeholders } = checkReleaseConfig(root);
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
        "sed -i 's/APPLE_TEAM_ID/<your 10-character team id>/g' hosting/public/.well-known/apple-app-site-association apps/app/eas.json",
        "sed -i 's/APP_STORE_CONNECT_APP_ID/<numeric app id>/' apps/app/eas.json",
        "node scripts/check-release-config.mjs --release",
      ],
      verify: "node scripts/check-release-config.mjs --release prints 'release config ok'",
    };
    console.log(`::viber-manual::${JSON.stringify(marker)}`);
    process.exit(1);
  }
  console.log(
    release
      ? "release config ok"
      : "config ok (placeholders remain until the Apple account exists)",
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
