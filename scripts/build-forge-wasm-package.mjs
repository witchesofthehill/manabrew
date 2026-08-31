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

if (!skipEngine) run("bash", ["scripts/build-forge-wasm.sh"]);

for (const file of ["forgeharness.js", "forgeharness.js.wasm", "forge-engine.worker.js"]) {
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
  "vite.js",
  "vite.d.ts",
  "README.md",
  "LICENSE",
]) {
  cpSync(join(source, file), join(output, file));
}
for (const file of ["forgeharness.js", "forgeharness.js.wasm", "forge-engine.worker.js"]) {
  cpSync(join(root, "public", "forge", file), join(output, file));
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

console.log(`Built ${manifest.name}@${manifest.version} in ${output}`);
