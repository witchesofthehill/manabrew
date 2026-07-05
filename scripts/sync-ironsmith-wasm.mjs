#!/usr/bin/env node

import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDir, "..");
const sourceDir = join(projectRoot, "..", "ironsmith", "pkg");
const targetDir = join(projectRoot, "node_modules", "ironsmith-wasm");
const viteDepsDir = join(projectRoot, "node_modules", ".vite", "deps");

const packageFiles = [
  "package.json",
  "ironsmith.js",
  "ironsmith.d.ts",
  "ironsmith_bg.wasm",
  "ironsmith_bg.wasm.d.ts",
];

function hashPackage(dir) {
  const hash = createHash("sha256");
  for (const file of packageFiles) {
    const path = join(dir, file);
    if (!existsSync(path)) return null;
    hash.update(file);
    hash.update(readFileSync(path));
  }
  return hash.digest("hex");
}

if (!existsSync(sourceDir)) {
  console.warn(`[sync-ironsmith] ${sourceDir} not found; skipping Ironsmith WASM sync.`);
  process.exit(0);
}

const sourceHash = hashPackage(sourceDir);
if (!sourceHash) {
  console.warn(`[sync-ironsmith] ${sourceDir} is incomplete; skipping Ironsmith WASM sync.`);
  process.exit(0);
}

const targetHash = existsSync(targetDir) ? hashPackage(targetDir) : null;
if (sourceHash === targetHash) {
  console.log("[sync-ironsmith] ironsmith-wasm is current.");
  process.exit(0);
}

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });

rmSync(join(viteDepsDir, "ironsmith-wasm.js"), { force: true });
rmSync(join(viteDepsDir, "ironsmith-wasm.js.map"), { force: true });
rmSync(join(viteDepsDir, "_metadata.json"), { force: true });

console.log("[sync-ironsmith] copied ../ironsmith/pkg into node_modules/ironsmith-wasm.");
