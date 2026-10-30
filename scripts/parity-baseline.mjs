#!/usr/bin/env node
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "manabrew-rs/crates/parity/regression.json");
const cardsetPath = join(root, "src-tauri/resources/cardset.rkyv");

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  console.log(`Usage: yarn parity:baseline [options]

  --bin <path>          parity binary (default: target/parity/parity)
  --java-jar <path>     Java harness jar (default: forge-harness/target/...)
  --out <dir>           output directory (default: target/parity-baseline/<sha>)
  --fuzz <n>            fuzz iterations (default: 50; 0 disables)
  --fuzz-chunk <n>      iterations per fuzz process (default: 1)
  --fuzz-timeout <s>    seconds per fuzz chunk before it is killed (default: 600)
  --max-turns <n>       max turns for fuzz games (default: 20)
  --no-suite            skip regression.json single-matchup entries
  --no-matrix           skip regression.json matrix entries
  --no-build            use the existing parity binary without rebuilding it
  --no-cache            pass --no-cache to every parity run
  --resume              reuse reports already present in the output directory
  --help                show this help`);
  process.exit(0);
}

if (!options.noBuild && options.bin === "target/parity/parity") {
  console.error("[baseline] building parity");
  const build = spawnSync(
    "cargo",
    ["build", "--profile", "parity", "-p", "parity", "--bin", "parity", "--features", "storage"],
    { cwd: root, stdio: "inherit" },
  );
  if (build.error) {
    fail(`failed to run cargo: ${build.error.message}`);
  }
  if (build.status !== 0) {
    fail("parity build failed");
  }
}

const bin = resolve(root, options.bin);
const jar = resolve(root, options.javaJar);
const gitSha = git(["rev-parse", "HEAD"]);
const outDir = resolve(root, options.out ?? join("target/parity-baseline", gitSha.slice(0, 12)));
const inventoryPath = join(outDir, "inventory.json");
const suiteDir = join(outDir, "suite");
const matrixDir = join(outDir, "matrix");
const fuzzPath = join(outDir, "fuzz.json");

if (!existsSync(bin)) {
  fail(`parity binary not found at ${relative(root, bin)}; build it with:
  cargo build --profile parity -p parity --bin parity --features storage`);
}
if (!existsSync(cardsetPath)) {
  fail(`cardset archive not found at ${relative(root, cardsetPath)}; build it with yarn parity`);
}
if ((!options.noSuite || !options.noMatrix || options.fuzz > 0) && !existsSync(jar)) {
  fail(`Java harness jar not found at ${relative(root, jar)}; build it with yarn build:harness`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(suiteDir, { recursive: true });
mkdirSync(matrixDir, { recursive: true });

const jarStale = existsSync(jar) ? staleJar() : null;
if (jarStale) {
  console.error(
    `[baseline] warning: ${relative(root, jarStale.path)} is newer than the Java harness jar`,
  );
}

const common = [];
if (existsSync(jar)) {
  common.push("--java-jar", jar);
}
if (options.noCache) {
  common.push("--no-cache");
}

console.error(`[baseline] writing ${displayPath(outDir)}`);
console.error("[baseline] inventory");
const inventoryRun = runParity(
  ["--inventory", "--output", inventoryPath],
  join(outDir, "inventory.log"),
);
const inventory = readJson(inventoryPath);

const entries = JSON.parse(readFileSync(registryPath, "utf8"));
const suiteEntries = entries.filter((entry) => !tokenize(entry.args).includes("--matrix"));
const matrixEntries = entries.filter((entry) => tokenize(entry.args).includes("--matrix"));

const suite = { entries: [], totals: emptyTotals(), failures: [] };
const matrix = { entries: [], totals: emptyTotals(), failures: [] };
const fuzz = {
  iterations: options.fuzz,
  master_seed: 42,
  max_turns: options.maxTurns,
  passed: 0,
  failed: 0,
  errors: 0,
  failures: [],
  chunks: [],
};
const coveredCards = new Set();

writeSummary();

if (!options.noSuite) {
  for (const entry of suiteEntries) {
    const file = join(suiteDir, `${slug(entry.name)}.json`);
    const reused = options.resume && existsSync(file);
    console.error(`[baseline] suite: ${entry.name}${reused ? " (reused)" : ""}`);
    const run = reused
      ? { status: null }
      : runParity(
          [...common, ...tokenize(entry.args), "--format", "json", "--output", file],
          join(suiteDir, `${slug(entry.name)}.log`),
        );
    const report = readJson(file);
    const summary = summarizeReport(report, coveredCards);
    suite.totals = addTotals(suite.totals, summary);
    suite.failures.push(
      ...summary.failures.map((failure) => ({ source: "suite", name: entry.name, ...failure })),
    );
    suite.entries.push({
      name: entry.name,
      args: entry.args,
      command_status: run.status,
      reused,
      ...summary,
    });
  }
  writeSummary();
}

if (!options.noMatrix) {
  for (const entry of matrixEntries) {
    const file = join(matrixDir, `${slug(entry.name)}.json`);
    const reused = options.resume && existsSync(file);
    console.error(`[baseline] matrix: ${entry.name}${reused ? " (reused)" : ""}`);
    const run = reused
      ? { status: null }
      : runParity(
          [...common, ...tokenize(entry.args), "--format", "json", "--output", file],
          join(matrixDir, `${slug(entry.name)}.log`),
        );
    const report = readJson(file);
    const summary = summarizeReport(report, coveredCards);
    matrix.totals = addTotals(matrix.totals, summary);
    matrix.failures.push(
      ...summary.failures.map((failure) => ({ source: "matrix", name: entry.name, ...failure })),
    );
    matrix.entries.push({
      name: entry.name,
      args: entry.args,
      command_status: run.status,
      reused,
      ...summary,
    });
  }
  writeSummary();
}

if (options.fuzz > 0) {
  const chunkSize = Math.max(1, options.fuzzChunk);
  const chunkTimeoutMs = options.fuzzTimeout * 1000;
  const chunks = [];
  const results = [];
  let poolSize = 0;
  let totalCards = 0;

  for (let start = 0; start < options.fuzz; start += chunkSize) {
    const count = Math.min(chunkSize, options.fuzz - start);
    const chunkFile = join(outDir, `fuzz-chunk-${start}.json`);
    const chunkLog = join(outDir, `fuzz-chunk-${start}.log`);
    const markerFile = join(outDir, `fuzz-chunk-${start}.timeout`);
    const haveReport = existsSync(chunkFile);
    const haveLog = existsSync(chunkLog);
    const reusable = options.resume && (haveReport || haveLog);
    console.error(`[baseline] fuzz ${start}..${start + count}${reusable ? " (reused)" : ""}`);

    let report = null;
    let timedOut = false;
    let seed = null;
    if (reusable) {
      report = readJson(chunkFile);
      timedOut = existsSync(markerFile) || (haveLog && !report);
      if (timedOut) {
        seed = seedFromLog(chunkLog);
      }
    } else {
      const startedAt = Date.now();
      const run = runParity(
        [
          ...common,
          "--fuzz",
          "--iterations",
          String(count),
          "--fuzz-start",
          String(start),
          "--master-seed",
          "42",
          "--max-turns",
          String(options.maxTurns),
          "--format",
          "json",
          "--output",
          chunkFile,
        ],
        chunkLog,
        chunkTimeoutMs,
      );
      timedOut = run.timedOut;
      report = readJson(chunkFile);
      if (timedOut) {
        killJavaServers(jar, Math.round((Date.now() - startedAt) / 1000));
        seed = seedFromLog(chunkLog);
        writeFileSync(
          markerFile,
          `${JSON.stringify(
            {
              start,
              count,
              seed,
              message: `fuzz chunk ${start}..${start + count} exceeded ${options.fuzzTimeout}s`,
            },
            null,
            2,
          )}\n`,
        );
      }
    }

    const chunk = {
      start,
      count,
      reused: reusable,
      timed_out: timedOut,
      passed: report?.passed ?? 0,
      failed: report?.failed ?? 0,
      errors: report?.errors ?? 0,
    };
    chunks.push(chunk);

    if (report) {
      poolSize = report.pool_size ?? poolSize;
      totalCards = report.total_cards ?? totalCards;
      for (const result of report.results ?? []) {
        results.push(result);
        for (const card of result.result?.covered_cards ?? []) {
          coveredCards.add(card);
        }
        if (result.result?.status === "pass" || result.result?.status === "skipped") {
          continue;
        }
        fuzz.failures.push({
          source: "fuzz",
          name: `fuzz#${result.iteration}`,
          iteration: result.iteration,
          deck1: result.result.deck1,
          deck2: result.result.deck2,
          deck1_spec: result.deck1_spec,
          deck2_spec: result.deck2_spec,
          seed: result.game_seed,
          status: result.result.status,
          first_divergence: result.result.first_divergence,
          error_message: result.result.error_message,
          skip_reason: result.result.skip_reason,
        });
      }
    } else {
      fuzz.failures.push({
        source: "fuzz",
        name: `fuzz#${start}`,
        iteration: start,
        seed,
        status: "error",
        error_message: timedOut
          ? `fuzz chunk ${start}..${start + count} exceeded ${options.fuzzTimeout}s`
          : `fuzz chunk ${start}..${start + count} produced no report`,
      });
    }
  }

  results.sort((a, b) => a.iteration - b.iteration);
  fuzz.passed = chunks.reduce((sum, chunk) => sum + chunk.passed, 0);
  fuzz.failed = chunks.reduce((sum, chunk) => sum + chunk.failed, 0);
  fuzz.errors = chunks.reduce((sum, chunk) => sum + chunk.errors, 0);
  for (const chunk of chunks) {
    if (chunk.timed_out || chunk.passed + chunk.failed + chunk.errors === 0) {
      fuzz.errors += chunk.count;
    }
  }
  fuzz.chunks = chunks;
  fuzz.iterations = options.fuzz;
  fuzz.command_status = chunks.every((chunk) => !chunk.timed_out) ? 0 : 1;

  writeFileSync(
    fuzzPath,
    `${JSON.stringify(
      {
        master_seed: 42,
        iterations: options.fuzz,
        max_turns: options.maxTurns,
        pool_size: poolSize,
        total_cards: totalCards,
        passed: fuzz.passed,
        failed: fuzz.failed,
        errors: fuzz.errors,
        results,
      },
      null,
      2,
    )}\n`,
  );
}

writeSummary();

const infrastructureFailure =
  !inventory ||
  suite.entries.some((entry) => entry.total === 0) ||
  matrix.entries.some((entry) => entry.total === 0) ||
  (options.fuzz > 0 && fuzz.command_status !== 0 && fuzz.passed + fuzz.failed + fuzz.errors === 0);

console.log(`\nBaseline written to ${displayPath(outDir)}`);
console.log(
  `  suite:  ${suite.totals.passed}/${suite.totals.total} pass` +
    ` | matrix: ${matrix.totals.passed}/${matrix.totals.total} pass` +
    ` | fuzz: ${fuzz.passed}/${fuzz.passed + fuzz.failed + fuzz.errors} pass`,
);
if (
  suite.totals.failed + suite.totals.errors > 0 ||
  matrix.totals.failed + matrix.totals.errors > 0
) {
  console.log("  failures are recorded in summary.md; this run is diagnostic, not a gate");
}

process.exit(infrastructureFailure ? 1 : 0);

function parseArgs(argv) {
  const parsed = {
    bin: "target/parity/parity",
    javaJar: "forge-harness/target/forge-harness-jar-with-dependencies.jar",
    fuzz: 50,
    fuzzChunk: 1,
    fuzzTimeout: 600,
    maxTurns: 20,
    noSuite: false,
    noMatrix: false,
    noBuild: false,
    noCache: false,
    resume: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) fail(`missing value for ${arg}`);
      return argv[i];
    };
    switch (arg) {
      case "--bin":
        parsed.bin = value();
        break;
      case "--java-jar":
        parsed.javaJar = value();
        break;
      case "--out":
        parsed.out = value();
        break;
      case "--fuzz":
        parsed.fuzz = Number(value());
        break;
      case "--fuzz-chunk":
        parsed.fuzzChunk = Number(value());
        break;
      case "--fuzz-timeout":
        parsed.fuzzTimeout = Number(value());
        break;
      case "--max-turns":
        parsed.maxTurns = Number(value());
        break;
      case "--no-suite":
        parsed.noSuite = true;
        break;
      case "--no-matrix":
        parsed.noMatrix = true;
        break;
      case "--no-build":
        parsed.noBuild = true;
        break;
      case "--no-cache":
        parsed.noCache = true;
        break;
      case "--resume":
        parsed.resume = true;
        break;
      case "--help":
        parsed.help = true;
        break;
      default:
        fail(`unknown option: ${arg}`);
    }
  }

  if (!Number.isInteger(parsed.fuzz) || parsed.fuzz < 0) {
    fail("--fuzz must be a non-negative integer");
  }
  if (!Number.isInteger(parsed.fuzzChunk) || parsed.fuzzChunk < 1) {
    fail("--fuzz-chunk must be a positive integer");
  }
  if (!Number.isInteger(parsed.fuzzTimeout) || parsed.fuzzTimeout < 1) {
    fail("--fuzz-timeout must be a positive integer");
  }
  if (!Number.isInteger(parsed.maxTurns) || parsed.maxTurns <= 0) {
    fail("--max-turns must be a positive integer");
  }
  return parsed;
}

function tokenize(input) {
  const args = [];
  let current = "";
  let quote = null;
  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (quote) {
    fail(`unterminated quote in regression args: ${input}`);
  }
  if (current) {
    args.push(current);
  }
  return args;
}

function runParity(args, logPath, timeoutMs) {
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...(timeoutMs ? { timeout: timeoutMs, killSignal: "SIGKILL" } : {}),
  });
  const timedOut = result.error?.code === "ETIMEDOUT";
  if (result.error && !timedOut) {
    fail(`failed to run ${bin}: ${result.error.message}`);
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  if (logPath && output) {
    writeFileSync(logPath, `${output}\n`);
  }
  return { ...result, timedOut };
}

function seedFromLog(logPath) {
  if (!existsSync(logPath)) {
    return null;
  }
  const matches = [
    ...readFileSync(logPath, "utf8").matchAll(/fuzz iteration \d+\/\d+ seed=(\d+)/g),
  ];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : null;
}

function killJavaServers(jarPath, maxAgeSeconds) {
  const ps = spawnSync("ps", ["-eo", "pid,etimes,args"], { encoding: "utf8" });
  for (const line of ps.stdout.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) {
      continue;
    }
    const [, pid, elapsed, args] = match;
    if (!args.includes(jarPath) || !/(^|\/)java(\s|$)/.test(args)) {
      continue;
    }
    if (Number(elapsed) > maxAgeSeconds) {
      continue;
    }
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      continue;
    }
  }
}

function readJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function summarizeReport(report, coveredCards) {
  const totals = emptyTotals();
  const failures = [];
  for (const result of report?.results ?? []) {
    for (const card of result.covered_cards ?? []) {
      coveredCards.add(card);
    }
    totals.total += 1;
    if (result.status === "pass") {
      totals.passed += 1;
    } else if (result.status === "skipped") {
      totals.skipped += 1;
    } else if (result.status === "error") {
      totals.errors += 1;
    } else {
      totals.failed += 1;
    }
    if (result.status === "fail" || result.status === "error") {
      failures.push({
        deck1: result.deck1,
        deck2: result.deck2,
        seed: result.seed,
        status: result.status,
        first_divergence: result.first_divergence,
        error_message: result.error_message,
        skip_reason: result.skip_reason,
      });
    }
  }
  return { ...totals, failures };
}

function emptyTotals() {
  return { total: 0, passed: 0, failed: 0, errors: 0, skipped: 0 };
}

function addTotals(left, right) {
  return {
    total: left.total + right.total,
    passed: left.passed + right.passed,
    failed: left.failed + right.failed,
    errors: left.errors + right.errors,
    skipped: left.skipped + right.skipped,
  };
}

function buildClusters(failures) {
  const clusters = new Map();
  for (const failure of failures) {
    const divergence = failure.first_divergence;
    const key = divergence
      ? `${divergence.phase}|${normalizeField(divergence.field)}`
      : `error|${firstLine(failure.error_message) ?? "unknown"}`;
    const cluster = clusters.get(key) ?? {
      key,
      phase: divergence?.phase ?? "error",
      field: divergence ? normalizeField(divergence.field) : null,
      count: 0,
      examples: [],
    };
    cluster.count += 1;
    if (cluster.examples.length < 5) {
      cluster.examples.push({
        source: failure.source,
        name: failure.name,
        deck1: failure.deck1,
        deck2: failure.deck2,
        seed: failure.seed,
        turn: divergence?.turn ?? null,
        rust_value: divergence?.rust_value ?? null,
        java_value: divergence?.java_value ?? null,
      });
    }
    clusters.set(key, cluster);
  }
  return [...clusters.values()].sort((a, b) => b.count - a.count);
}

function buildCoverage(inventory, coveredCards) {
  const pool = new Set(inventory?.cards ?? []);
  const covered = [...coveredCards];
  const inPool = covered.filter((card) => pool.has(card));
  return {
    covered_total: covered.length,
    covered_in_pool: inPool.length,
    pool_size: pool.size,
    pool_percent: percent(inPool.length, pool.size),
    covered_not_in_pool: covered.length - inPool.length,
  };
}

function buildManifest({ bin, jar, gitSha, jarStale, inventoryRun }) {
  const jarExists = existsSync(jar);
  return {
    generated_at: new Date().toISOString(),
    git_sha: gitSha,
    git_branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: git(["status", "--porcelain"]).trim() !== "",
    command: process.argv.slice(2).join(" "),
    parity_bin: relative(root, bin),
    parity_bin_sha256: sha256File(bin),
    java_jar: jarExists ? relative(root, jar) : null,
    java_jar_sha256: jarExists ? sha256File(jar) : null,
    java_jar_mtime: jarExists ? statSync(jar).mtime.toISOString() : null,
    java_sources_newer_than_jar: jarStale ? relative(root, jarStale.path) : null,
    cardset_sha256: sha256File(cardsetPath),
    cache: options.noCache ? "disabled" : "enabled",
    resume: options.resume,
    fuzz_iterations: options.fuzz,
    fuzz_master_seed: 42,
    fuzz_max_turns: options.maxTurns,
    inventory_status: inventoryRun.status,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function buildSummary() {
  const failures = [...suite.failures, ...matrix.failures, ...fuzz.failures];
  return {
    generated_at: new Date().toISOString(),
    manifest: buildManifest({ bin, jar, gitSha, jarStale, inventoryRun }),
    inventory: inventory
      ? {
          total_scanned: inventory.stats.total_scanned,
          included: inventory.stats.included,
          pool_percent: percent(inventory.stats.included, inventory.stats.total_scanned),
          excluded_multi_faced: inventory.stats.excluded_multi_faced,
          excluded_no_mana_cost: inventory.stats.excluded_no_mana_cost,
          excluded_unusable_type: inventory.stats.excluded_unusable_type,
          excluded_parse_failure: inventory.stats.excluded_parse_failure,
          excluded_unimplemented_effect: inventory.stats.excluded_unimplemented_effect,
          missing_apis: Object.entries(inventory.stats.missing_apis ?? {})
            .map(([api, cards]) => ({
              api,
              cards,
              examples: inventory.stats.missing_api_examples?.[api] ?? [],
            }))
            .sort((a, b) => b.cards - a.cards),
        }
      : null,
    suite,
    matrix,
    fuzz,
    coverage: buildCoverage(inventory, coveredCards),
    clusters: buildClusters(failures),
    failures,
  };
}

function writeSummary() {
  const summary = buildSummary();
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(summary.manifest, null, 2)}\n`);
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(outDir, "summary.md"), renderMarkdown(summary, outDir));
}

function staleJar() {
  const paths = [
    join(root, "forge/forge-core/src"),
    join(root, "forge/forge-game/src"),
    join(root, "forge/forge-ai/src"),
    join(root, "forge/forge-gui/src"),
    join(root, "forge-harness/src"),
  ];
  const jarTime = statSync(jar).mtimeMs;
  let newest = null;
  for (const path of paths) {
    const candidate = newestFile(path);
    if (
      candidate &&
      candidate.mtimeMs > jarTime &&
      (!newest || candidate.mtimeMs > newest.mtimeMs)
    ) {
      newest = candidate;
    }
  }
  return newest;
}

function newestFile(path) {
  if (!existsSync(path)) {
    return null;
  }
  let newest = null;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      const child = newestFile(fullPath);
      if (child && (!newest || child.mtimeMs > newest.mtimeMs)) {
        newest = child;
      }
    } else {
      const mtimeMs = statSync(fullPath).mtimeMs;
      if (!newest || mtimeMs > newest.mtimeMs) {
        newest = { path: fullPath, mtimeMs };
      }
    }
  }
  return newest;
}

function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function normalizeField(field) {
  return String(field ?? "").replace(/\[\d+\]/g, "[*]");
}

function firstLine(value) {
  return String(value ?? "")
    .split("\n")[0]
    .trim();
}

function percent(part, total) {
  return total > 0 ? (part / total) * 100 : 0;
}

function displayPath(path) {
  const relativePath = relative(root, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function fail(message) {
  console.error(`[baseline] ${message}`);
  process.exit(1);
}

function renderMarkdown(summary, directory) {
  const { manifest, inventory, suite, matrix, fuzz, coverage, clusters } = summary;
  const lines = [];
  lines.push(`# Parity baseline — ${manifest.git_sha.slice(0, 12)}`);
  lines.push("");
  lines.push(
    `Generated ${summary.generated_at} on \`${manifest.git_branch}\`${manifest.dirty ? " (dirty)" : ""}.`,
  );
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push("| Layer | Pass | Fail | Error | Skip | Total |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  lines.push(totalsRow("Suite", suite.totals));
  lines.push(totalsRow("Matrix", matrix.totals));
  lines.push(
    `| Fuzz | ${fuzz.passed} | ${fuzz.failed} | ${fuzz.errors} | 0 | ${fuzz.passed + fuzz.failed + fuzz.errors} |`,
  );
  lines.push("");
  if (inventory) {
    lines.push("## Static inventory");
    lines.push("");
    lines.push(
      `Pool: **${inventory.included}/${inventory.total_scanned}** (${inventory.pool_percent.toFixed(1)}%).`,
    );
    lines.push("");
    lines.push("| Exclusion | Cards |");
    lines.push("| --- | ---: |");
    for (const key of [
      "excluded_multi_faced",
      "excluded_no_mana_cost",
      "excluded_unusable_type",
      "excluded_parse_failure",
      "excluded_unimplemented_effect",
    ]) {
      lines.push(`| ${key.replace("excluded_", "").replaceAll("_", " ")} | ${inventory[key]} |`);
    }
    lines.push("");
    if (inventory.missing_apis.length > 0) {
      lines.push("### Missing effect APIs");
      lines.push("");
      lines.push("| API | Cards | Examples |");
      lines.push("| --- | ---: | --- |");
      for (const item of inventory.missing_apis) {
        lines.push(
          `| \`${item.api}\` | ${item.cards} | ${item.examples.map((name) => `\`${name}\``).join(", ")} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("## Coverage");
  lines.push("");
  lines.push(
    `Cards exercised: **${coverage.covered_in_pool}/${coverage.pool_size}** of the pool (${coverage.pool_percent.toFixed(1)}%); ` +
      `${coverage.covered_not_in_pool} played cards outside the pool.`,
  );
  lines.push("");
  lines.push("## Failure clusters");
  lines.push("");
  if (clusters.length === 0) {
    lines.push("No failures recorded.");
  } else {
    lines.push("| Count | Phase | Field | Examples |");
    lines.push("| ---: | --- | --- | --- |");
    for (const cluster of clusters.slice(0, 25)) {
      const examples = cluster.examples
        .map(
          (example) =>
            `${example.source}:${example.name} seed=${example.seed} T${example.turn ?? "?"}`,
        )
        .join("<br>");
      lines.push(
        `| ${cluster.count} | ${cluster.phase} | \`${cluster.field ?? "error"}\` | ${examples} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Suite entries");
  lines.push("");
  lines.push("| Entry | Pass | Fail | Error | Skip | Total |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const entry of suite.entries) {
    lines.push(
      `| ${entry.name} | ${entry.passed} | ${entry.failed} | ${entry.errors} | ${entry.skipped} | ${entry.total} |`,
    );
  }
  lines.push("");
  lines.push("## Matrix entries");
  lines.push("");
  if (matrix.entries.length === 0) {
    lines.push("No matrix entries recorded.");
  } else {
    lines.push("| Entry | Pass | Fail | Error | Skip | Total |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const entry of matrix.entries) {
      lines.push(
        `| ${entry.name} | ${entry.passed} | ${entry.failed} | ${entry.errors} | ${entry.skipped} | ${entry.total} |`,
      );
    }
  }
  lines.push("");
  lines.push("## Manifest");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(manifest, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Reproduce");
  lines.push("");
  lines.push("```sh");
  lines.push(`yarn parity:baseline --out ${displayPath(directory)}`);
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function totalsRow(label, totals) {
  return `| ${label} | ${totals.passed} | ${totals.failed} | ${totals.errors} | ${totals.skipped} | ${totals.total} |`;
}
