#!/usr/bin/env node
import { writeFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv } from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "ops/manifest.json");

function currentVersion() {
  try {
    return JSON.parse(readFileSync(OUT, "utf8")).version ?? 0;
  } catch {
    return 0;
  }
}

const meta = JSON.parse(
  execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
  }),
);

const packages = {};
for (const name of meta.packages.map((p) => p.name).sort())
  packages[name] = meta.packages.find((p) => p.name === name).version;

const version = currentVersion() + (argv.includes("--increment") ? 1 : 0);
const json = JSON.stringify({ version, packages }, null, 2) + "\n";

if (argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== json) {
    console.error("ops/manifest.json is stale — run `yarn gen:manifest`");
    process.exit(1);
  }
} else {
  writeFileSync(OUT, json);
  console.error(`wrote ${OUT} (version ${version})`);
}
