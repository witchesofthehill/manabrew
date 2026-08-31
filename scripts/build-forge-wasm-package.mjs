#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages", "forge-wasm");
const output = join(root, "target", "npm", "forge-wasm");
const generated = join(root, "target", "forge-wasm-assets");
const skipEngine = process.argv.includes("--skip-engine");
// The GraalVM engine takes a Web Image toolchain and the better part of an
// hour, and it is opaque to everything the packaging does with it. `--stub-
// engine` stands placeholders in for the two GraalVM outputs so a PR check can
// exercise the parts that actually change: the asset selector, the cardset,
// the worker facade, `npm pack`, and a real consumer's Vite build. It marks
// the output so verification skips the checks that need the real engine, and
// the marker is outside the package's `files` so it can never be published.
const stubEngine = process.argv.includes("--stub-engine");
const GRAALVM_OUTPUTS = ["forgeharness.js", "forgeharness.js.wasm"];
const STUB_MARKER = ".stub-engine";
const executable = platform() === "win32" ? ".exe" : "";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function findWasmPack() {
  const probe = spawnSync(platform() === "win32" ? "where" : "which", ["wasm-pack"], {
    stdio: "ignore",
  });
  if (probe.status === 0) return "wasm-pack";
  const cargoBinary = join(homedir(), ".cargo", "bin", `wasm-pack${executable}`);
  return existsSync(cargoBinary) ? cargoBinary : null;
}

if (!skipEngine && !stubEngine) run("bash", ["scripts/build-forge-wasm.sh"]);

// forge-engine.worker.js is committed, so it is required even when stubbing:
// it is the file a change to the worker facade lands in.
const staged = stubEngine
  ? ["forge-engine.worker.js"]
  : [...GRAALVM_OUTPUTS, "forge-engine.worker.js"];
for (const file of staged) {
  if (!existsSync(join(root, "public", "forge", file))) {
    throw new Error(`Missing public/forge/${file}; build the Forge WebAssembly engine first.`);
  }
}

let wasmPack = findWasmPack();
if (!wasmPack) {
  run("cargo", ["install", "wasm-pack"]);
  wasmPack = findWasmPack();
}
if (!wasmPack) throw new Error("wasm-pack is unavailable after installation.");

rmSync(output, { recursive: true, force: true });
rmSync(generated, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
mkdirSync(generated, { recursive: true });

run(wasmPack, [
  "build",
  "--release",
  "--target",
  "web",
  "--out-dir",
  generated,
  "--out-name",
  "forge-assets",
  "manabrew-rs/crates/forge-wasm-assets",
]);

run("cargo", [
  "run",
  "--release",
  "-p",
  "forge-cardset-archive",
  "--bin",
  "build-cardset-archive",
  "--features",
  "build",
  "--",
  "forge/forge-gui/res/cardsfolder",
  "forge/forge-gui/res/tokenscripts",
  "forge/forge-gui/res/editions",
  "forge/forge-gui/res/blockdata",
  "forge/forge-gui/res/lists/TypeLists.txt",
  join(output, "cardset.rkyv"),
]);

for (const file of [
  "package.json",
  "forge.js",
  "forge.d.ts",
  "deckCards.js",
  "deckCards.d.ts",
  "seat.js",
  "seat.d.ts",
  "vite.js",
  "vite.d.ts",
  "README.md",
  "LICENSE",
]) {
  cpSync(join(source, file), join(output, file));
}
cpSync(
  join(root, "public", "forge", "forge-engine.worker.js"),
  join(output, "forge-engine.worker.js"),
);
if (stubEngine) {
  // Big enough to clear a bundler's inline-asset threshold, or Vite turns the
  // stub into a data URI and verification can no longer tell whether the
  // engine would have been emitted as a fetchable asset.
  const padding = 64 * 1024;
  writeFileSync(join(output, STUB_MARKER), "");
  writeFileSync(
    join(output, "forgeharness.js"),
    `// stub: no Web Image engine in this build\n${"//\n".repeat(padding / 3)}`,
  );
  const stubWasm = new Uint8Array(padding);
  stubWasm.set([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
  writeFileSync(join(output, "forgeharness.js.wasm"), stubWasm);
} else {
  for (const file of GRAALVM_OUTPUTS) {
    cpSync(join(root, "public", "forge", file), join(output, file));
  }
}
cpSync(join(generated, "forge-assets.js"), join(output, "forge-assets.js"));
cpSync(join(generated, "forge-assets_bg.wasm"), join(output, "forge-assets_bg.wasm"));

const manifestPath = join(output, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedVersion = process.env.FORGE_WASM_VERSION;
if (expectedVersion && manifest.version !== expectedVersion) {
  throw new Error(`Package version ${manifest.version} does not match release ${expectedVersion}.`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// package.json is the only place the version is written by hand. Stamp the
// runtime export from it here rather than asking a release to keep three
// files in step, which is how @manabrew/protocol shipped a stale one.
const entryPath = join(output, "forge.js");
const entry = readFileSync(entryPath, "utf8");
const versionExport = /^export const VERSION = ".*";$/m;
if (!versionExport.test(entry)) throw new Error("forge.js has no VERSION export to stamp.");
writeFileSync(
  entryPath,
  entry.replace(versionExport, `export const VERSION = ${JSON.stringify(manifest.version)};`),
);

console.log(
  `Built ${manifest.name}@${manifest.version} in ${output}` +
    (stubEngine ? " (engine stubbed — not publishable)" : ""),
);
