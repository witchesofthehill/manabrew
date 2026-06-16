#!/usr/bin/env node
import { readFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = join(root, "manabrew-rs/crates/parity/regression.json");
const javaJar = join(root, "forge-harness/target/forge-harness-jar-with-dependencies.jar");

// Ensure the Java harness JAR is up-to-date before running any parity test.
execSync("node scripts/harness.mjs ensure", { stdio: "inherit", cwd: root });

const name = process.argv[2];
const extraArgs = process.argv.slice(3).join(" ");

if (!name) {
  const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
  console.error("Usage: yarn parity <test-name> [extra-args]\n");
  console.error("Available tests:");
  for (const entry of registry) {
    console.error(`  - ${entry.name}`);
  }
  console.error("\nExtra args are appended to the cargo command (e.g. --investigate --verbose)");
  process.exit(1);
}

const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
const entry = registry.find((e) => e.name === name);
if (!entry) {
  console.error(`Unknown test: "${name}". Available: ${registry.map((e) => e.name).join(", ")}`);
  process.exit(1);
}

const cmd = `cargo run --profile parity -p parity --bin parity -- --java-jar "${javaJar}" ${entry.args}${extraArgs ? " " + extraArgs : ""}`;
console.log(`> ${cmd}\n`);
execSync(cmd, { stdio: "inherit", cwd: root });
