#!/usr/bin/env node
/**
 * Plays a matrix of headless Forge games and keeps every decision they cost.
 *
 * One game says little: the spread between games of the same shape is 200x in
 * production. This runs `forge-wasm-game.mjs` across seat counts, deck
 * combinations and seeds, a game per process so a slow one cannot lean on the
 * others' clocks, and writes the JSONL under `runs/<tag>/` with a manifest.
 * `pool.py` then reads the run as one population.
 *
 *   node scripts/engine-bench/stress.mjs --tag main --seats 2,4 --games 12
 *   node scripts/engine-bench/stress.mjs --tag pr --engine packages/forge-wasm --seats 4
 *   python3 scripts/engine-bench/pool.py runs/pr --baseline runs/main
 *
 * An A/B is the same plan under several engines: `--engines base=npm,pr=<dir>`
 * plays every game once per arm with the same seed and decks, arms
 * interleaved in the queue so whatever else the machine is doing lands on
 * both. Output goes to `runs/<tag>/<arm>/`; `pool.py --ab runs/<tag>` reads it.
 *
 * `--decks` picks the pool the combinations are drawn from: a comma-separated
 * list of preset basenames or deck files, or a directory of deck JSON. Each game
 * takes the next `seats` decks off a rotation of that pool, so the pool is
 * covered before any deck repeats. `--jobs` bounds the parallelism; half the
 * cores keeps a decision's clock honest under load. `--per-engine N` plays N
 * games back to back in one engine, the way a tab does, so heap retention
 * between games shows in the samples.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}
const flag = (name) => process.argv.includes(`--${name}`);

const tag = option("tag", new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-"));
const seatCounts = option("seats", "2,4").split(",").map(Number);
const gamesPerShape = Number(option("games", 8));
const perEngine = Number(option("per-engine", 1));
const jobs = Number(option("jobs", Math.max(1, Math.floor(cpus().length / 2))));
const policy = option("policy", "greedy");
const arms = option("engines", null)
  ? option("engines")
      .split(",")
      .map((pair) => {
        const [name, source] = pair.split("=");
        return { name, source: source ?? name };
      })
  : [{ name: null, source: option("engine", "npm") }];
const timeoutS = Number(option("timeout", 1800));
const seed0 = Number(option("seed", 1000));
const traceGc = flag("trace-gc");
const outDir = resolve(option("out", join(here, "runs")), tag);

const COMMANDER_POOL = [
  "kaalia_regression_commander",
  "starter_deck_animar",
  "real_teval_commander",
  "neheb_minotaur_commander",
  "ashling_limitless_commander",
  "hearthhull_world_shaper_commander",
  "ramses_commander",
  "starter_deck_ghired",
  "starter_deck_yarok",
  "starter_deck_urza_chief_artificer",
];

function deckPool(spec) {
  if (!spec) return COMMANDER_POOL;
  const path = resolve(spec);
  if (existsSync(path) && statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => f.endsWith(".json") && f !== "index.json")
      .sort()
      .map((f) => join(path, f));
  }
  return spec.split(",");
}

const pool = deckPool(option("decks", null));
if (pool.length < Math.max(...seatCounts)) {
  console.error(`deck pool has ${pool.length} decks, fewer than the largest table`);
  process.exit(2);
}

/** Every game's arguments, laid out before anything runs. */
const plan = [];
let rotation = 0;
for (const seats of seatCounts) {
  for (let i = 0; i < gamesPerShape; i += 1) {
    const decks = Array.from({ length: seats }, (_, k) => pool[(rotation + k) % pool.length]);
    rotation += seats;
    const seed = seed0 + (plan.length / arms.length) * perEngine;
    const name = `s${seats}-g${String(i + 1).padStart(3, "0")}`;
    for (const arm of arms)
      plan.push({ name, seats, decks, seed, arm: arm.name, engine: arm.source });
  }
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(
    {
      tag,
      startedAt: new Date().toISOString(),
      engines: Object.fromEntries(arms.map((a) => [a.name ?? "engine", a.source])),
      policy,
      perEngine,
      jobs,
      node: process.version,
      games: plan.map((g) => ({ ...g, decks: g.decks.map((d) => basename(d, ".json")) })),
    },
    null,
    2,
  ),
);

for (const arm of arms) mkdirSync(join(outDir, arm.name ?? ""), { recursive: true });

function play(game) {
  const out = join(outDir, game.arm ?? "", `${game.name}.jsonl`);
  const args = [
    ...(traceGc ? ["--trace-gc"] : []),
    join(here, "forge-wasm-game.mjs"),
    "--engine",
    game.engine,
    "--seats",
    String(game.seats),
    "--decks",
    game.decks.join(","),
    "--policy",
    policy,
    "--games",
    String(perEngine),
    "--seed",
    String(game.seed),
    "--timeout",
    String(timeoutS),
    "--out",
    out,
  ];
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const log = [];
    child.stdout.on("data", (d) => log.push(d));
    child.stderr.on("data", (d) => log.push(d));
    child.on("close", (code) => {
      writeFileSync(out.replace(/\.jsonl$/, ".log"), Buffer.concat(log));
      const s = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `${code === 0 ? "ok  " : "FAIL"} ${game.arm ? `${game.arm}/` : ""}${game.name} ${s}s ${game.decks.map((d) => basename(d, ".json")).join(" ")}`,
      );
      resolve({ name: game.name, arm: game.arm, code, seconds: Number(s) });
    });
  });
}

console.log(
  `${plan.length} games, ${jobs} at a time, engines=${arms.map((a) => a.source).join(" ")} policy=${policy} -> ${outDir}`,
);
const queue = [...plan];
const results = [];
await Promise.all(
  Array.from({ length: jobs }, async () => {
    while (queue.length) results.push(await play(queue.shift()));
  }),
);

const failed = results.filter((r) => r.code !== 0);
writeFileSync(
  join(outDir, "results.json"),
  JSON.stringify({ finishedAt: new Date().toISOString(), results }, null, 2),
);
console.log(`\n${results.length - failed.length}/${results.length} games finished cleanly`);
if (failed.length)
  console.log(`not clean: ${failed.map((r) => `${r.arm ? `${r.arm}/` : ""}${r.name}`).join(" ")}`);
console.log(
  arms.length > 1
    ? `python3 scripts/engine-bench/pool.py --ab ${outDir}`
    : `python3 scripts/engine-bench/pool.py ${outDir}`,
);
