#!/usr/bin/env node
// Runs a filtered regression.json through two parity binaries (branch vs main)
// in rust-only mode and diffs the emitted JSON per entry.
//
// One invocation per (entry, side): the binary's own multi-game / matrix mode
// runs all seeds in parallel via rayon (see run_multi_game_mode rust-only
// branch). We just pass entry.args through verbatim and compare outputs.
//
// Usage:
//   node scripts/parity-rust-vs-rust.mjs \
//     --branch-bin ./target/release/parity \
//     --main-bin   ./main-bin/parity \
//     --entries    existing-entries.json \
//     --cards-dir  forge/forge-gui/res/cardsfolder \
//     --decks-dir  public/preset_decks \
//     --out-dir    rust-vs-rust-out
//
// Exit codes: 0 = all match, 1 = at least one divergence, 2 = harness error.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    out[key] = val;
  }
  return out;
}

function shellSplit(s) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        continue;
      }
      cur += c;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Fields that are wall-clock or otherwise non-deterministic debugging metadata.
const IGNORED_FIELDS = new Set(["timestamp_ms"]);

// Log-array keys whose contents we filter to snapshot entries only. The
// production java-vs-rust parity comparator (parity::comparator) only
// diffs StateSnapshots; Decision and Callback log entries are inspection
// metadata for the debugger, not part of the parity verdict. Including them
// here would make rust-vs-rust strictly stricter than the production check
// for no observable benefit (and would catch e.g. callback ordering changes
// that produce identical game state).
const LOG_ARRAY_KEYS = new Set(["rust_log", "java_log"]);

function isSnapshotEntry(e) {
  return e && typeof e === "object" && e.entry_type === "snapshot";
}

function stripIgnored(value) {
  if (Array.isArray(value)) {
    for (const v of value) stripIgnored(v);
  } else if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (IGNORED_FIELDS.has(k)) {
        delete value[k];
      } else if (LOG_ARRAY_KEYS.has(k) && Array.isArray(value[k])) {
        value[k] = value[k].filter(isSnapshotEntry);
        for (const e of value[k]) stripIgnored(e);
      } else {
        stripIgnored(value[k]);
      }
    }
  }
}

function hashTrace(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  stripIgnored(parsed);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

function runBin(binPath, args, outJson) {
  const finalArgs = [...args, "--format", "json", "--output", outJson];
  // Silence stdout (binary prints progress to stderr); capture stderr for failures.
  const res = spawnSync(binPath, finalArgs, {
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status, stderr: res.stderr ?? "" };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const branchBin = args["branch-bin"];
  const mainBin = args["main-bin"];
  const entriesPath = args["entries"];
  const cardsDir = args["cards-dir"];
  const decksDir = args["decks-dir"];
  const outDir = args["out-dir"] || "rust-vs-rust-out";

  if (!branchBin || !mainBin || !entriesPath) {
    console.error("missing --branch-bin / --main-bin / --entries");
    process.exit(2);
  }
  if (!existsSync(branchBin) || !existsSync(mainBin)) {
    console.error("binary not found");
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  const entries = JSON.parse(readFileSync(entriesPath, "utf8"));

  console.log(`rust-vs-rust: ${entries.length} entries × 2 sides`);

  const divergences = [];
  const t0 = Date.now();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const argv = shellSplit(entry.args);
    if (cardsDir) argv.push("--cards-dir", cardsDir);
    if (decksDir) argv.push("--decks-dir", decksDir);

    const branchOut = join(outDir, `${entry.name}.branch.json`);
    const mainOut = join(outDir, `${entry.name}.main.json`);

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    process.stdout.write(`[${i + 1}/${entries.length}] (${elapsed}s) ${entry.name} ... `);

    const tStart = Date.now();
    const b = runBin(branchBin, argv, branchOut);
    const m = runBin(mainBin, argv, mainOut);
    const dt = ((Date.now() - tStart) / 1000).toFixed(1);

    if (b.status !== 0 || m.status !== 0) {
      divergences.push({
        name: entry.name,
        kind: "run_failed",
        branch_exit: b.status,
        main_exit: m.status,
        branch_stderr: b.stderr.slice(-2000),
        main_stderr: m.stderr.slice(-2000),
      });
      console.log(`FAIL (${dt}s, branch exit=${b.status}, main exit=${m.status})`);
      continue;
    }

    const bh = hashTrace(branchOut);
    const mh = hashTrace(mainOut);
    if (bh !== mh) {
      divergences.push({ name: entry.name, kind: "output_mismatch", branch_sha: bh, main_sha: mh });
      console.log(`DIVERGED (${dt}s)`);
    } else {
      console.log(`ok (${dt}s)`);
    }
  }

  const wallSec = ((Date.now() - t0) / 1000).toFixed(1);
  const summary = { entries: entries.length, wall_seconds: Number(wallSec), divergences };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  if (divergences.length > 0) {
    console.error(
      `rust-vs-rust: ${divergences.length}/${entries.length} entries diverged in ${wallSec}s`,
    );
    process.exit(1);
  }
  console.log(`rust-vs-rust: all ${entries.length} entries matched in ${wallSec}s`);
}

main();
