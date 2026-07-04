#!/usr/bin/env node
// Builds the Tauri updater manifest (tauri.json) for a tagged release.
// The version comes from tauri.conf.json at the tag — the version the
// shipped binaries report, kept equal to the tag by release-please. The
// artifact signatures come from the .sig files CI downloaded next to the
// bundles; URLs point at the GitHub release assets for the tag.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, env, exit } from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`gen-updater-manifest: ${msg}`);
  exit(1);
}

function arg(name) {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) die(`missing required ${name} <value>`);
  return argv[i + 1];
}

const tag = arg("--tag");
const assetsDir = resolve(arg("--assets"));
const out = resolve(arg("--out"));
const repo = env.GITHUB_REPOSITORY ?? "witchesofthehill/manabrew";

const version = JSON.parse(
  readFileSync(resolve(ROOT, "src-tauri/tauri.conf.json"), "utf8"),
).version;
if (tag !== `v${version}`)
  die(`tag ${tag} does not match the tauri.conf.json version ${version} it was built from`);

const manifestVersion = JSON.parse(readFileSync(resolve(ROOT, "ops/manifest.json"), "utf8"))
  .packages?.manabrew;
if (manifestVersion !== version)
  console.error(
    `warning: ops/manifest.json says manabrew ${manifestVersion} — stale next to ${version}; ` +
      "run `yarn gen:manifest` on the next PR",
  );

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(assetsDir);

function platformEntry(label, matches) {
  const candidates = files.filter(matches);
  if (candidates.length !== 1)
    die(`expected exactly one ${label} bundle under ${assetsDir}, found ${candidates.length}`);
  const bundle = candidates[0];
  const sig = files.find((f) => f === `${bundle}.sig`);
  if (!sig) die(`missing signature file ${bundle}.sig — was the build signed?`);
  return {
    signature: readFileSync(sig, "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(basename(bundle))}`,
  };
}

const json =
  JSON.stringify(
    {
      version,
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": platformEntry("macOS .app.tar.gz", (f) => f.endsWith(".app.tar.gz")),
        "windows-x86_64": platformEntry("Windows NSIS setup.exe", (f) => f.endsWith("-setup.exe")),
      },
    },
    null,
    2,
  ) + "\n";

writeFileSync(out, json);
console.error(`wrote ${out} for ${tag}`);
