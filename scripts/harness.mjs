#!/usr/bin/env node
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { fileURLToPath } from "url";
import { delimiter, join, relative } from "path";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
const root = join(scriptsDir, "..");
const forgeRoot = join(root, "forge");
const harnessRoot = join(root, "forge-harness");
const jarPath = join(harnessRoot, "target", "forge-harness-jar-with-dependencies.jar");
const checksumPath = join(harnessRoot, "target", ".harness-sources-checksum");
const runtimeDir = join(root, "src-tauri", "resources", "forge-runtime");
const runtimeForgeGuiDir = join(runtimeDir, "forge-gui");
const runtimeResDir = join(runtimeForgeGuiDir, "res");
const runtimeCardsfolderDir = join(runtimeResDir, "cardsfolder");
const runtimeHarnessJar = join(runtimeDir, "forge-harness.jar");
const runtimeStamp = join(runtimeDir, ".stage-stamp");
const sourceResDir = join(forgeRoot, "forge-gui", "res");
const sourceCardsfolderDir = join(sourceResDir, "cardsfolder");

const stagedResDirs = new Set([
  "editions",
  "formats",
  "lists",
  "tokenscripts",
  "draft",
  "effects",
  "cube",
  "defaults",
  "blockdata",
  "setlookup",
  "ai",
  "sealed",
]);

const sourceDirs = [
  join(forgeRoot, "forge-core", "src"),
  join(forgeRoot, "forge-game", "src"),
  join(forgeRoot, "forge-ai", "src"),
  join(forgeRoot, "forge-gui", "src"),
  join(harnessRoot, "src"),
];

const pomFiles = [
  join(forgeRoot, "pom.xml"),
  join(forgeRoot, "forge-core", "pom.xml"),
  join(forgeRoot, "forge-game", "pom.xml"),
  join(forgeRoot, "forge-ai", "pom.xml"),
  join(forgeRoot, "forge-gui", "pom.xml"),
  join(harnessRoot, "pom.xml"),
];

function walkFiles(dir, predicate, acc = []) {
  if (!existsSync(dir)) {
    return acc;
  }

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

function computeChecksum() {
  const javaFiles = sourceDirs
    .flatMap((dir) => walkFiles(dir, (filePath) => filePath.endsWith(".java")))
    .sort();

  const protocolFiles = walkFiles(
    join(root, "manabrew-rs", "crates", "manabrew-protocol", "src"),
    (filePath) => filePath.endsWith(".rs"),
  ).sort();

  const hashedEntries = [
    ...javaFiles.map(
      (filePath) => `${relative(root, filePath)}:${sha256Buffer(readFileSync(filePath))}`,
    ),
    ...protocolFiles.map(
      (filePath) => `${relative(root, filePath)}:${sha256Buffer(readFileSync(filePath))}`,
    ),
    ...pomFiles
      .filter((filePath) => existsSync(filePath))
      .sort()
      .map((filePath) => `${relative(root, filePath)}:${sha256Buffer(readFileSync(filePath))}`),
  ];

  return sha256Buffer(Buffer.from(hashedEntries.join("\n"), "utf8"));
}

// Everything build-native.{sh,ps1} reads that computeChecksum() does not: it
// hashes what goes *into the jar*, while native-image also consumes the FFI
// entrypoint, the reflection config and Forge's languages tree. A key missing
// any of these would serve a stale libforgeharness to a release build.
function computeNativeChecksum() {
  const nativeRoot = join(harnessRoot, "native");
  const nativeFiles = [
    join(nativeRoot, "forge", "harness", "ffi", "ForgeNative.java"),
    join(harnessRoot, "build-native.sh"),
    join(harnessRoot, "build-native.ps1"),
    ...walkFiles(join(nativeRoot, "frozen-config"), () => true).sort(),
    ...walkFiles(join(nativeRoot, "extra-config"), () => true).sort(),
    ...walkFiles(join(forgeRoot, "forge-gui", "res", "languages"), () => true).sort(),
  ];

  const hashedEntries = [
    `jar:${computeChecksum()}`,
    ...nativeFiles
      .filter((filePath) => existsSync(filePath))
      .map((filePath) => `${relative(root, filePath)}:${sha256Buffer(readFileSync(filePath))}`),
  ];

  return sha256Buffer(Buffer.from(hashedEntries.join("\n"), "utf8"));
}

function updateChecksum() {
  mkdirSync(join(harnessRoot, "target"), { recursive: true });
  writeFileSync(checksumPath, `${computeChecksum()}\n`);
  console.log("harness: checksum updated");
}

function isStale() {
  if (!existsSync(jarPath)) {
    console.log(`harness: JAR not found at ${jarPath}`);
    return true;
  }

  if (!existsSync(checksumPath)) {
    console.log("harness: no stored checksum, assuming stale");
    return true;
  }

  const storedChecksum = readFileSync(checksumPath, "utf8").trim();
  const currentChecksum = computeChecksum();
  if (storedChecksum !== currentChecksum) {
    console.log("harness: sources changed (checksum mismatch)");
    return true;
  }

  return false;
}

function canRun(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "ignore",
    shell: process.platform === "win32" && command.toLowerCase().endsWith(".cmd"),
  });

  return !result.error && result.status === 0;
}

function resolveMaven() {
  // The harness builds from the repo root via the aggregator pom, so the forge
  // submodule's mvnw wrapper can't be used (its basedir is forge/). Use a
  // system Maven, which is what CI and the Docker images use too.
  if (process.platform === "win32" && canRun("mvn.cmd", ["-version"])) {
    return "mvn.cmd";
  }

  if (canRun("mvn", ["-version"])) {
    return "mvn";
  }

  return null;
}

function resolveJar() {
  if (canRun("jar", ["--version"]) || canRun("jar", ["-help"])) {
    return "jar";
  }

  return null;
}

function assertPrereqs() {
  const missing = [];

  if (!canRun("java", ["-version"])) {
    missing.push("Java 18+");
  }

  if (!resolveMaven()) {
    missing.push("Maven");
  }

  if (missing.length === 0) {
    return;
  }

  console.error(`harness: missing prerequisites: ${missing.join(", ")}`);
  if (process.platform === "win32") {
    console.error("Windows setup:");
    console.error("  1. Install a JDK and verify with: java -version");
    console.error("  2. Install Maven and verify with: mvn -version");
    console.error("  3. Restart PowerShell so PATH changes are picked up");
  } else {
    console.error("Install Java 18+ and Maven, then verify with:");
    console.error("  java -version");
    console.error("  mvn -version");
  }
  process.exit(1);
}

function generateProtocolSources() {
  console.log("harness: generating typed prompt classes from the protocol...");
  const steps = [
    [
      "cargo",
      ["run", "-q", "-p", "manabrew-protocol", "--bin", "gen-protocol", "--", "src/protocol"],
    ],
    [process.execPath, ["scripts/gen-harness-prompts.mjs", "forge-harness/src/main/java"]],
  ];
  for (const [cmd, args] of steps) {
    const result = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) {
      console.error(
        `harness: protocol codegen FAILED (${cmd} exited ${result.status ?? result.error})`,
      );
      process.exit(result.status ?? 1);
    }
  }
}

function rebuild() {
  generateProtocolSources();
  assertPrereqs();
  const maven = resolveMaven();

  console.log("harness: rebuilding JAR...");
  // Build from the repo root via the aggregator pom so forge-harness and the
  // engine modules it depends on share one reactor (resolves the engine's
  // ${revision} version without cross-reactor install/flatten).
  const result = spawnSync(maven, ["-pl", "forge-harness", "-am", "package", "-DskipTests"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32" && maven.toLowerCase().endsWith(".cmd"),
  });

  if (result.error) {
    console.error(`harness: failed to launch Maven: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`harness: rebuild FAILED (exit code ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }

  const regressionClasspath = [join(harnessRoot, "target", "test-classes"), jarPath].join(
    delimiter,
  );
  console.log("harness: running regression tests...");
  for (const regressionClass of [
    "forge.harness.host.InteractiveSnapshotExtractorTest",
    "forge.harness.common.HarnessPlayPlumbingTest",
  ]) {
    const regression = spawnSync("java", ["-cp", regressionClasspath, regressionClass], {
      cwd: root,
      stdio: "inherit",
    });
    if (regression.status !== 0) {
      console.error(
        `harness: regression tests FAILED (exit code ${regression.status ?? regression.error})`,
      );
      process.exit(regression.status ?? 1);
    }
  }

  updateChecksum();
  console.log("harness: rebuild complete");
}

function latestMtimeMs(dir, predicate) {
  let latest = 0;
  for (const filePath of walkFiles(dir, predicate)) {
    latest = Math.max(latest, statSync(filePath).mtimeMs);
  }
  return latest;
}

function isRuntimeStale() {
  const zipPath = join(runtimeCardsfolderDir, "cardsfolder.zip");
  if (!existsSync(runtimeHarnessJar) || !existsSync(zipPath) || !existsSync(runtimeStamp)) {
    return true;
  }

  const stampMtime = statSync(runtimeStamp).mtimeMs;
  if (statSync(jarPath).mtimeMs > stampMtime) {
    return true;
  }

  return latestMtimeMs(sourceResDir, () => true) > stampMtime;
}

function stageRuntime({ force = false } = {}) {
  if (!existsSync(jarPath)) {
    console.error(`harness: cannot stage runtime, JAR not found at ${jarPath}`);
    process.exit(1);
  }

  if (!existsSync(sourceResDir)) {
    console.error(`harness: cannot stage runtime, Forge res not found at ${sourceResDir}`);
    process.exit(1);
  }

  if (!existsSync(sourceCardsfolderDir)) {
    console.error(
      `harness: cannot stage runtime, cardsfolder not found at ${sourceCardsfolderDir}`,
    );
    process.exit(1);
  }

  if (!force && !isRuntimeStale()) {
    console.log("harness: Tauri runtime is up-to-date");
    return;
  }

  const jar = resolveJar();
  if (!jar) {
    console.error("harness: missing JDK jar tool");
    console.error("Install a JDK and verify with: jar --version");
    process.exit(1);
  }

  rmSync(runtimeDir, { recursive: true, force: true });
  mkdirSync(runtimeDir, { recursive: true });
  copyFileSync(jarPath, runtimeHarnessJar);

  mkdirSync(runtimeResDir, { recursive: true });
  for (const dir of stagedResDirs) {
    const src = join(sourceResDir, dir);
    if (existsSync(src)) {
      cpSync(src, join(runtimeResDir, dir), { recursive: true });
    }
  }

  mkdirSync(runtimeCardsfolderDir, { recursive: true });
  const zipPath = join(runtimeCardsfolderDir, "cardsfolder.zip");
  const result = spawnSync(jar, ["cf", zipPath, "-C", sourceCardsfolderDir, "."], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`harness: failed to launch jar tool: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`harness: cardsfolder.zip creation FAILED (exit code ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }

  writeFileSync(runtimeStamp, `${new Date().toISOString()}\n`);
  console.log(`harness: staged Tauri runtime at ${relative(root, runtimeDir)}`);
}

const mode = process.argv[2] ?? "ensure";

switch (mode) {
  case "build":
    rebuild();
    stageRuntime({ force: true });
    break;
  case "test":
    rebuild();
    break;
  case "ensure":
    if (isStale()) {
      rebuild();
    } else {
      console.log("harness: JAR is up-to-date");
    }
    stageRuntime();
    break;
  case "stage":
    stageRuntime({ force: true });
    break;
  case "check":
    process.exit(isStale() ? 1 : 0);
    break;
  case "update-checksum":
    updateChecksum();
    break;
  case "checksum":
    process.stdout.write(`${computeChecksum()}\n`);
    break;
  case "native-checksum":
    process.stdout.write(`${computeNativeChecksum()}\n`);
    break;
  default:
    console.error(
      "Usage: node scripts/harness.mjs <build|test|ensure|stage|check|update-checksum|checksum|native-checksum>",
    );
    process.exit(1);
}
