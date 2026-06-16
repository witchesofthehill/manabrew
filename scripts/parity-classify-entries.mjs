#!/usr/bin/env node
// Partitions a branch's regression.json into `new` (added or args-changed vs main)
// and `existing` (byte-identical to the entry on main). Emits both as JSON files.
//
// Usage:
//   node scripts/parity-classify-entries.mjs \
//     --branch manabrew-rs/crates/parity/regression.json \
//     --main   main-ref/manabrew-rs/crates/parity/regression.json \
//     --out-new   new-entries.json \
//     --out-existing existing-entries.json

import { readFileSync, writeFileSync } from "node:fs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    out[a.slice(2)] = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const branch = JSON.parse(readFileSync(args.branch, "utf8"));
const main = JSON.parse(readFileSync(args.main, "utf8"));

const mainByName = new Map(main.map((e) => [e.name, e]));

const fresh = [];
const existing = [];
for (const e of branch) {
  const prev = mainByName.get(e.name);
  if (!prev || prev.args !== e.args) {
    fresh.push(e);
  } else {
    existing.push(e);
  }
}

writeFileSync(args["out-new"], JSON.stringify(fresh, null, 2));
writeFileSync(args["out-existing"], JSON.stringify(existing, null, 2));

console.log(`classify: ${fresh.length} new, ${existing.length} existing`);
