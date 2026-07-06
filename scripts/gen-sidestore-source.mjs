#!/usr/bin/env node
// Builds the SideStore source manifest (apps.json) for a tagged release.
// SideStore adds the source URL (https://play.manabrew.app/sidestore/apps.json)
// and installs/updates the app from the `versions[0]` entry. The version comes
// from tauri.conf.json at the tag; the IPA size is measured from the built
// artifact; the download URL points at the IPA this release publishes next to
// apps.json on the deploy host.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = "https://play.manabrew.app/sidestore";

function die(msg) {
  console.error(`gen-sidestore-source: ${msg}`);
  exit(1);
}

function arg(name, required = true) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) {
    if (required) die(`missing required ${name} <value>`);
    return undefined;
  }
  return argv[i + 1];
}

const tag = arg("--tag");
const ipaPath = resolve(arg("--ipa"));
const out = resolve(arg("--out"));
const date = arg("--date", false) ?? new Date().toISOString().slice(0, 10);

const version = JSON.parse(
  readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8"),
).version;
if (tag !== `v${version}`)
  die(`tag ${tag} does not match the tauri.conf.json version ${version} it was built from`);

const size = statSync(ipaPath).size;
const downloadURL = `${BASE_URL}/Manabrew-${version}.ipa`;
const description =
  "Manabrew — a Magic: The Gathering client powered by a Rust rewrite of the Forge rules engine.";

const source = {
  name: "Manabrew",
  identifier: "com.manabrew.source",
  subtitle: "MTG client powered by a Rust rules engine",
  iconURL: `${BASE_URL}/icon.png`,
  website: "https://manabrew.app",
  tintColor: "6C4AB6",
  apps: [
    {
      name: "Manabrew",
      bundleIdentifier: "com.manabrew.app",
      developerName: "Manabrew",
      subtitle: "Magic: The Gathering client",
      localizedDescription: description,
      iconURL: `${BASE_URL}/icon.png`,
      tintColor: "6C4AB6",
      category: "games",
      screenshotURLs: [],
      // Top-level fields for older AltStore-format clients; `versions` for SideStore.
      version,
      versionDate: date,
      versionDescription: `Manabrew ${version}`,
      downloadURL,
      size,
      versions: [
        {
          version,
          date,
          localizedDescription: `Manabrew ${version}`,
          downloadURL,
          size,
          minOSVersion: "14.0",
        },
      ],
      appPermissions: { entitlements: [], privacy: {} },
    },
  ],
};

writeFileSync(out, `${JSON.stringify(source, null, 2)}\n`);
console.log(`gen-sidestore-source: wrote ${out} (Manabrew ${version}, ${size} bytes)`);
