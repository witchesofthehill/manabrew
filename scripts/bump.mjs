#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, argv, exit } from "node:process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const APP_PACKAGE = "manabrew";
const APP_EXTRA_DIRS = ["src", "public"];
const APP_EXTRA_FILES = [
  "package.json",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "yarn.lock",
];
const APP_MIRROR_FILES = ["package.json", "src-tauri/tauri.conf.json"];

const paint = (n) => (s) => `\x1b[${n}m${s}\x1b[0m`;
const dim = paint(2);
const bold = paint(1);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);
const cyan = paint(36);

function die(msg) {
  console.error(red(msg));
  exit(1);
}

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function refExists(ref) {
  try {
    execFileSync("git", ["rev-parse", "--verify", ref], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function packages() {
  const meta = JSON.parse(
    execFileSync("cargo", ["metadata", "--no-deps", "--format-version", "1"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    }),
  );
  return meta.packages
    .map((p) => ({
      name: p.name,
      version: p.version,
      manifest: relative(ROOT, p.manifest_path),
      dir: relative(ROOT, dirname(p.manifest_path)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function diffBase() {
  const ref = ["origin/main", "main"].find(refExists);
  if (!ref) return null;
  return git(["merge-base", ref, "HEAD"]);
}

function changedFiles(base) {
  return git(["diff", "--name-only", base])
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function attribute(files, pkgs) {
  const dirs = pkgs.filter((p) => p.dir && p.dir !== ".");
  const app = pkgs.find((p) => p.name === APP_PACKAGE);
  const changed = new Set();
  const unattributed = [];
  for (const f of files) {
    let best = null;
    for (const p of dirs) {
      if ((f === p.dir || f.startsWith(p.dir + "/")) && (!best || p.dir.length > best.dir.length)) {
        best = p;
      }
    }
    if (!best && app) {
      const inApp =
        APP_EXTRA_FILES.includes(f) || APP_EXTRA_DIRS.some((d) => f === d || f.startsWith(d + "/"));
      if (inApp) best = app;
    }
    if (best) changed.add(best.name);
    else unattributed.push(f);
  }
  return { changed, unattributed };
}

function parse(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function bump(version, kind) {
  const p = parse(version);
  if (!p) return null;
  const [maj, min, pat] = p;
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  return version;
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function setPackageVersion(manifest, next) {
  const path = resolve(ROOT, manifest);
  const text = readFileSync(path, "utf8");
  const re = /^version\s*=\s*"[^"]+"/m;
  if (!re.test(text)) return false;
  writeFileSync(path, text.replace(re, `version = "${next}"`));
  return true;
}

function setDepRequirements(manifests, name, next) {
  const re = new RegExp(
    `(["']?${esc(name)}["']?\\s*=\\s*\\{[^}\\n]*?version\\s*=\\s*")([^"]+)(")`,
    "m",
  );
  for (const manifest of manifests) {
    const path = resolve(ROOT, manifest);
    const text = readFileSync(path, "utf8");
    if (re.test(text)) writeFileSync(path, text.replace(re, `$1${next}$3`));
  }
}

function setJsonVersion(file, next) {
  const path = resolve(ROOT, file);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
}

function apply(plan, pkgs) {
  const manifests = pkgs.map((p) => p.manifest);
  for (const { pkg, next } of plan) {
    if (!setPackageVersion(pkg.manifest, next))
      die(`could not find version field in ${pkg.manifest}`);
    setDepRequirements(manifests, pkg.name, next);
    if (pkg.name === APP_PACKAGE) for (const f of APP_MIRROR_FILES) setJsonVersion(f, next);
  }
  try {
    execFileSync("cargo", ["update", "--workspace", "--offline"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    console.log(dim("note: run `cargo build` to refresh Cargo.lock"));
  }
}

function regenManifest() {
  execFileSync("node", ["scripts/gen-manifest.mjs", "--increment"], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

function printPlan(plan, unattributed) {
  if (unattributed?.length) {
    console.log(yellow(`\n${unattributed.length} changed file(s) not owned by any package:`));
    for (const f of unattributed) console.log(dim(`  ${f}`));
  }
  console.log("");
  if (!plan.length) {
    console.log(dim("no packages to bump"));
    return;
  }
  for (const { pkg, next } of plan) {
    console.log(`  ${bold(pkg.name.padEnd(30))} ${dim(pkg.version)} ${dim("→")} ${green(next)}`);
  }
}

async function runAuto(pkgs, dryRun) {
  const base = diffBase();
  if (!base) die("no `main`/`origin/main` ref to diff against");
  const { changed, unattributed } = attribute(changedFiles(base), pkgs);
  const plan = pkgs
    .filter((p) => changed.has(p.name))
    .map((pkg) => ({ pkg, kind: "patch", next: bump(pkg.version, "patch") }));
  console.log(cyan(`auto bump — patching packages changed vs ${dim(base.slice(0, 12))}`));
  printPlan(plan, unattributed);
  if (dryRun) return;
  if (plan.length) apply(plan, pkgs);
  regenManifest();
  if (plan.length) console.log(green(`bumped ${plan.length} package(s)`));
}

async function runManual(pkgs, dryRun) {
  console.log(cyan("manual bump — ") + dim("[M]ajor  [m]inor  [p]atch  ⏎ skip  q abort\n"));
  const rl = createInterface({ input: stdin, output: stdout });
  const eof = new Promise((res) => rl.once("close", () => res(null)));
  const kinds = { M: "major", m: "minor", p: "patch" };
  const plan = [];
  for (const pkg of pkgs) {
    const reply = await Promise.race([
      rl.question(`  ${bold(pkg.name.padEnd(30))} ${dim(pkg.version)}  `),
      eof,
    ]);
    if (reply === null) break;
    const ans = reply.trim();
    if (ans === "q") {
      rl.close();
      die("aborted");
    }
    const kind = kinds[ans];
    if (kind) {
      const next = bump(pkg.version, kind);
      if (!next) console.log(red(`    skipping ${pkg.name}: non-semver version ${pkg.version}`));
      else plan.push({ pkg, kind, next });
    }
  }
  rl.close();
  printPlan(plan, []);
  if (dryRun) return;
  if (plan.length) apply(plan, pkgs);
  regenManifest();
  if (plan.length) console.log(green(`bumped ${plan.length} package(s)`));
}

const args = new Set(argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log("usage: yarn bump (--auto | --manual) [--dry-run]");
  exit(0);
}
const dryRun = args.has("--dry-run");
const pkgs = packages();
if (args.has("--auto") && !args.has("--manual")) await runAuto(pkgs, dryRun);
else if (args.has("--manual") && !args.has("--auto")) await runManual(pkgs, dryRun);
else die("pick exactly one mode: --auto or --manual (see --help)");
