#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { argv, exit } from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = "ops/manifest.json";
const baseRef = argv[2] || "origin/main";

function version(text) {
  try {
    const v = JSON.parse(text).version;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

const head = version(readFileSync(resolve(ROOT, FILE), "utf8"));
if (head === null) {
  console.error(`${FILE}: missing or malformed top-level version`);
  exit(1);
}

let base = -1;
try {
  const parsed = version(
    execFileSync("git", ["show", `${baseRef}:${FILE}`], { cwd: ROOT, encoding: "utf8" }),
  );
  if (parsed !== null) base = parsed;
} catch {
  base = -1;
}

if (head <= base) {
  console.error(
    `manifest version (${head}) is not ahead of ${baseRef} (${base}). Run \`yarn bump --auto\` (or --manual) and commit ${FILE}.`,
  );
  exit(1);
}
console.log(`manifest version ok: ${head} > ${base}`);
