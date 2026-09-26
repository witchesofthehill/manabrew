#!/usr/bin/env node
import { spawnSync } from "child_process";
import { existsSync, rmSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const outputs = [
  "forge/forge-core/target",
  "forge/forge-game/target",
  "forge/forge-ai/target",
  "forge/forge-gui/target",
  "forge-harness/target",
  "forge-harness/src/main/java/forge/harness/protocol",
  "forge-harness/native/build",
  "packages/forge-wasm/forgeharness.js",
  "packages/forge-wasm/forgeharness.js.wasm",
  "src/protocol",
  "src/api/hubTypes.ts",
  "src/wasm",
  "public/wasm",
  "src-tauri/resources/forge-runtime",
  "src-tauri/resources/cardset.rkyv",
  "dist",
];

for (const output of outputs) {
  const path = join(root, output);
  if (!existsSync(path)) continue;
  rmSync(path, { recursive: true, force: true });
  console.log(`clean: removed ${output}`);
}

if (process.argv.includes("--cargo")) {
  const result = spawnSync("cargo", ["clean"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
