#!/usr/bin/env node
//
// Skip `yarn build:wasm` when the inputs that feed it are unchanged.
//
// Hashes every source that influences `src/wasm/*` and `public/wasm/cardset.v4.rkyv`,
// stamps it under `src/wasm/.build-stamp.json`, and on next invocation re-hashes
// and compares. Match + outputs present → no-op. Else spawns `yarn build:wasm`
// and writes a fresh stamp on success.
//
// Inputs hashed by content:
//   - Cargo.toml + Cargo.lock at repo root
//   - every forge-engine .rs and Cargo.toml
//   - scripts/build-wasm.mjs (this script's behavior is part of the contract)
//
// Card-data dirs (forge-gui/res/{cardsfolder,tokenscripts,editions,blockdata})
// hold ~50k files, so we hash a manifest of path+size+mtime instead of contents —
// any add/remove/edit shows up as an mtime/size change.

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { join, dirname, relative } from "path";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDir, "..");

const OUTPUTS = [
  "src/wasm/forge_wasm_bg.wasm",
  "src/wasm/forge_wasm.js",
  "src/wasm/forge_wasm.d.ts",
  "public/wasm/cardset.manifest.json",
];

const STAMP_FILE = join(projectRoot, "src/wasm/.build-stamp.json");

const CONTENT_HASH_FILES = ["Cargo.toml", "Cargo.lock", "scripts/build-wasm.mjs"];

const CONTENT_HASH_DIRS = [
  { root: "forge-engine", match: (p) => p.endsWith(".rs") || p.endsWith("Cargo.toml") },
];

const MANIFEST_HASH_DIRS = [
  "forge/forge-gui/res/cardsfolder",
  "forge/forge-gui/res/tokenscripts",
  "forge/forge-gui/res/editions",
  "forge/forge-gui/res/blockdata",
];

function walk(root, predicate, out = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(root, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "target" || ent.name === "node_modules" || ent.name.startsWith("."))
        continue;
      walk(full, predicate, out);
    } else if (ent.isFile() && predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function hashContent(hash, absPath) {
  const rel = relative(projectRoot, absPath);
  hash.update(rel);
  hash.update("\0");
  try {
    hash.update(readFileSync(absPath));
  } catch {
    hash.update("MISSING");
  }
  hash.update("\n");
}

function hashManifest(hash, absPath) {
  const rel = relative(projectRoot, absPath);
  try {
    const s = statSync(absPath);
    hash.update(`${rel}\0${s.size}\0${Math.trunc(s.mtimeMs)}\n`);
  } catch {
    hash.update(`${rel}\0MISSING\n`);
  }
}

function computeInputHash() {
  const hash = createHash("sha256");

  for (const rel of CONTENT_HASH_FILES) {
    hashContent(hash, join(projectRoot, rel));
  }

  for (const { root, match } of CONTENT_HASH_DIRS) {
    const files = walk(join(projectRoot, root), match);
    files.sort();
    for (const f of files) hashContent(hash, f);
  }

  for (const rel of MANIFEST_HASH_DIRS) {
    const files = walk(join(projectRoot, rel), () => true);
    files.sort();
    for (const f of files) hashManifest(hash, f);
  }

  return hash.digest("hex");
}

function readStamp() {
  if (!existsSync(STAMP_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STAMP_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeStamp(inputHash) {
  writeFileSync(
    STAMP_FILE,
    JSON.stringify({ inputHash, outputs: OUTPUTS, writtenAt: new Date().toISOString() }, null, 2),
  );
}

function outputsPresent() {
  if (!OUTPUTS.every((rel) => existsSync(join(projectRoot, rel)))) return false;
  // Manifest lists the content-addressed archive name; confirm that file is
  // also on disk so a half-pruned `public/wasm/` triggers a rebuild.
  try {
    const manifest = JSON.parse(
      readFileSync(join(projectRoot, "public/wasm/cardset.manifest.json"), "utf8"),
    );
    return existsSync(join(projectRoot, "public/wasm", manifest.archive));
  } catch {
    return false;
  }
}

const inputHash = computeInputHash();
const stamp = readStamp();
const fresh = stamp?.inputHash === inputHash && outputsPresent();

if (fresh) {
  console.log("[ensure-wasm] up to date — skipping build:wasm");
  process.exit(0);
}

if (!stamp) {
  console.log("[ensure-wasm] no stamp — running build:wasm");
} else if (stamp.inputHash !== inputHash) {
  console.log("[ensure-wasm] inputs changed — running build:wasm");
} else {
  console.log("[ensure-wasm] output missing — running build:wasm");
}

const result = spawnSync("yarn", ["build:wasm"], {
  stdio: "inherit",
  cwd: projectRoot,
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

writeStamp(inputHash);
console.log("[ensure-wasm] build complete — stamp updated");
