#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "packages", "forge-wasm");
const output = join(root, "target", "npm", "forge-wasm");
const skipEngine = process.argv.includes("--skip-engine");
// The GraalVM engine takes a Web Image toolchain and the better part of an
// hour, and the packaging never looks inside it. `--stub-engine` fakes the two
// GraalVM outputs so a PR check can exercise everything else, and marks the
// output so verification skips the checks that need the real engine. The
// marker is outside `files`, so it can never be published.
const stubEngine = process.argv.includes("--stub-engine");
const GRAALVM_OUTPUTS = ["forgeharness.js", "forgeharness.js.wasm"];
const STUB_MARKER = ".stub-engine";

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!skipEngine && !stubEngine) run("bash", ["scripts/build-forge-wasm.sh"]);

// Committed, and the file a worker-facade change lands in, so it is required
// even when stubbing.
const staged = stubEngine
  ? ["forge-engine.worker.js"]
  : [...GRAALVM_OUTPUTS, "forge-engine.worker.js"];
for (const file of staged) {
  if (!existsSync(join(source, file))) {
    throw new Error(
      `Missing packages/forge-wasm/${file}; build the Forge WebAssembly engine first.`,
    );
  }
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const file of [
  "package.json",
  "forge.js",
  "forge.d.ts",
  "engine.js",
  "node.js",
  "node-worker.cjs",
  "forge-engine.worker.js",
  "stamp.js",
  "seat.js",
  "seat.d.ts",
  "vite.js",
  "vite.d.ts",
  "README.md",
  "LICENSE",
]) {
  cpSync(join(source, file), join(output, file));
}
if (stubEngine) {
  // Past a bundler's inline threshold, or Vite emits the stub as a data URI
  // and the "was it emitted as an asset?" check stops meaning anything.
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
    cpSync(join(source, file), join(output, file));
  }
}

const manifestPath = join(output, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedVersion = process.env.FORGE_WASM_VERSION;
if (expectedVersion && manifest.version !== expectedVersion) {
  throw new Error(`Package version ${manifest.version} does not match release ${expectedVersion}.`);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// package.json is the only version written by hand; the rest are stamped from
// it and the tree, rather than asking a release to keep several files in step
// (which is how @manabrew/protocol shipped a stale one).
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
const buildCommit = head.status === 0 ? head.stdout.trim() : "unknown";

const stampPath = join(output, "stamp.js");
let stamps = readFileSync(stampPath, "utf8");
for (const [name, value] of [
  ["VERSION", manifest.version],
  ["BUILD_COMMIT", buildCommit],
]) {
  const declaration = new RegExp(`^export const ${name} = ".*";$`, "m");
  if (!declaration.test(stamps)) throw new Error(`stamp.js has no ${name} export to stamp.`);
  stamps = stamps.replace(declaration, `export const ${name} = ${JSON.stringify(value)};`);
}
writeFileSync(stampPath, stamps);

console.log(
  `Built ${manifest.name}@${manifest.version} in ${output}` +
    (stubEngine ? " (engine stubbed — not publishable)" : ""),
);
