#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(root, "target", "npm", "forge-wasm");
const temporary = mkdtempSync(join(tmpdir(), "forge-wasm-package-"));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const required = [
  "forge.js",
  "forge.d.ts",
  "vite.js",
  "vite.d.ts",
  "forge-assets.js",
  "forge-assets_bg.wasm",
  "forge-engine.worker.js",
  "forgeharness.js",
  "forgeharness.js.wasm",
  "cardset.rkyv",
  "README.md",
  "LICENSE",
];
for (const file of required) statSync(join(packageDir, file));
if (statSync(join(packageDir, "forgeharness.js.wasm")).size < 30_000_000) {
  throw new Error("Forge engine WASM is unexpectedly small.");
}
if (statSync(join(packageDir, "cardset.rkyv")).size < 30_000_000) {
  throw new Error("Forge cardset is unexpectedly small.");
}
if (!readFileSync(join(packageDir, "forgeharness.js"), "utf8").includes("__forgeWasmUrl")) {
  throw new Error("Forge launcher does not honour the package WASM URL.");
}

const packed = JSON.parse(
  run("npm", ["pack", "--json", "--pack-destination", temporary], packageDir),
)[0];
const packedNames = new Set(packed.files.map((file) => file.path));
for (const file of required) {
  if (!packedNames.has(file)) throw new Error(`${file} is absent from npm pack output.`);
}
if ([...packedNames].some((file) => file.endsWith(".wat"))) {
  throw new Error("npm package contains a WebAssembly text dump.");
}

const consumer = join(temporary, "consumer");
run("mkdir", ["-p", consumer]);
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify({
    type: "module",
    dependencies: {
      "@manabrew/forge-wasm": "file:../package.tgz",
      typescript: "^5.9.3",
      vite: "^7.3.5",
    },
  }),
);
writeFileSync(join(consumer, "index.html"), '<script type="module" src="/src.js"></script>\n');
writeFileSync(
  join(consumer, "vite.config.js"),
  'import { forgeWasm } from "@manabrew/forge-wasm/vite"; export default { plugins: [forgeWasm()] };\n',
);
writeFileSync(
  join(consumer, "src.js"),
  'import { ForgeEngine, VERSION } from "@manabrew/forge-wasm"; console.log(ForgeEngine, VERSION);\n',
);
writeFileSync(
  join(consumer, "usage.ts"),
  'import { ForgeEngine } from "@manabrew/forge-wasm"; const engine = new ForgeEngine({ assets: "" }); void engine.startGame({ deck: { cards: [] } });\n',
);
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      lib: ["DOM", "ES2022"],
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
    },
    files: ["usage.ts"],
  }),
);
const tarball = join(temporary, packed.filename);
run("cp", [tarball, join(temporary, "package.tgz")]);
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
run(
  process.execPath,
  [join(consumer, "node_modules", "typescript", "bin", "tsc"), "--noEmit"],
  consumer,
);
run(
  process.execPath,
  [join(consumer, "node_modules", "vite", "bin", "vite.js"), "build"],
  consumer,
);

const assets = readdirSync(join(consumer, "dist", "assets"));
for (const expected of ["forge-engine.worker", "forgeharness", "cardset", "forge-assets_bg"]) {
  if (!assets.some((file) => file.includes(expected))) {
    throw new Error(`Vite did not emit the ${expected} package asset: ${assets.join(", ")}`);
  }
}

console.log(
  `Verified ${basename(tarball)}: ${(packed.size / 1024 / 1024).toFixed(1)} MiB tarball, ${packed.files.length} files.`,
);
