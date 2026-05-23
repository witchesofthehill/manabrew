#!/usr/bin/env node
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { join, relative } from "path";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(scriptsDir, "..");
const enginesDir = join(root, "forge-engine", "crates");
const cargoLock = join(root, "forge-engine", "Cargo.lock");
const workspaceManifest = join(root, "forge-engine", "Cargo.toml");
const buildScript = join(scriptsDir, "build-wasm.mjs");
const wasmDir = join(root, "src", "wasm");
const wasmArtifact = join(wasmDir, "forge_wasm_bg.wasm");
const wasmJsArtifact = join(wasmDir, "forge_wasm.js");
const cardsetArtifact = join(root, "public", "wasm", "cardset.v4.rkyv");
const checksumPath = join(wasmDir, ".build-hash");

function walkFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name === "node_modules") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, acc);
    } else if (predicate(fullPath)) {
      acc.push(fullPath);
    }
  }
  return acc;
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function forgeSubmoduleRev() {
  const r = spawnSync("git", ["submodule", "status", "forge"], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return "no-submodule";
  return r.stdout.trim();
}

function computeChecksum() {
  const sourceFiles = walkFiles(
    enginesDir,
    (p) => p.endsWith(".rs") || p.endsWith("Cargo.toml"),
  ).sort();

  const extra = [cargoLock, workspaceManifest, buildScript].filter((p) => existsSync(p));

  const entries = [
    ...sourceFiles.map((p) => `${relative(root, p)}:${sha256Buffer(readFileSync(p))}`),
    ...extra.map((p) => `${relative(root, p)}:${sha256Buffer(readFileSync(p))}`),
    `forge-submodule:${forgeSubmoduleRev()}`,
  ];

  return sha256Buffer(Buffer.from(entries.join("\n"), "utf8"));
}

function artifactsPresent() {
  return existsSync(wasmArtifact) && existsSync(wasmJsArtifact) && existsSync(cardsetArtifact);
}

function isStale() {
  if (!artifactsPresent()) {
    console.log("[ensure-wasm] artifacts missing — rebuild required");
    return true;
  }
  if (!existsSync(checksumPath)) {
    console.log("[ensure-wasm] no stored checksum — rebuild required");
    return true;
  }
  const stored = readFileSync(checksumPath, "utf8").trim();
  const current = computeChecksum();
  if (stored !== current) {
    console.log("[ensure-wasm] sources changed — rebuild required");
    return true;
  }
  return false;
}

function runBuild() {
  const result = spawnSync("yarn", ["build:wasm"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error("[ensure-wasm] build:wasm failed");
    process.exit(result.status ?? 1);
  }
  mkdirSync(wasmDir, { recursive: true });
  writeFileSync(checksumPath, `${computeChecksum()}\n`);
  console.log("[ensure-wasm] checksum updated");
}

if (isStale()) {
  runBuild();
} else {
  console.log("[ensure-wasm] wasm build is up to date");
}
