#!/usr/bin/env node

import { createHash } from "crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsDir, "..");
const sourceDir = join(projectRoot, "ironsmith", "pkg");
const targetDir = join(projectRoot, "node_modules", "ironsmith-wasm");
const viteDepsDir = join(projectRoot, "node_modules", ".vite", "deps");

const packageFiles = [
  "package.json",
  "ironsmith.js",
  "ironsmith.d.ts",
  "ironsmith_bg.wasm",
  "ironsmith_bg.wasm.d.ts",
];

const STUB_MESSAGE =
  "Ironsmith runtime is not bundled in this build. Check out the ironsmith submodule " +
  "(git submodule update --init ironsmith), build it with ./ironsmith/rebuild-wasm.sh, " +
  "then run `yarn sync:ironsmith` and enable the `ironsmithRuntime` feature flag.";

const stubFiles = {
  "package.json": `${JSON.stringify(
    {
      name: "ironsmith-wasm",
      version: "0.0.0-stub",
      type: "module",
      main: "ironsmith.js",
      types: "ironsmith.d.ts",
    },
    null,
    2,
  )}\n`,
  "ironsmith.js": `const NOT_BUNDLED = ${JSON.stringify(STUB_MESSAGE)};

export class WasmGame {
  constructor() {
    throw new Error(NOT_BUNDLED);
  }
  free() {}
  dispatch() {
    throw new Error(NOT_BUNDLED);
  }
  forfeitPlayer() {
    throw new Error(NOT_BUNDLED);
  }
  setPerspective() {
    throw new Error(NOT_BUNDLED);
  }
}

export default async function init() {
  throw new Error(NOT_BUNDLED);
}
`,
  "ironsmith.d.ts": `export class WasmGame {
  free(): void;
  dispatch(command: unknown): unknown;
  forfeitPlayer(player_index: number): unknown;
  setPerspective(player_index: number): void;
}

export default function init(module_or_path?: unknown): Promise<unknown>;
`,
  // Minimal valid empty WebAssembly module (magic + version). The stub build
  // never instantiates it — the `?url` import only needs a resolvable asset.
  "ironsmith_bg.wasm": Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
  "ironsmith_bg.wasm.d.ts": `export const memory: WebAssembly.Memory;\n`,
};

function hashFiles(read) {
  const hash = createHash("sha256");
  for (const file of packageFiles) {
    const contents = read(file);
    if (contents === null) return null;
    hash.update(file);
    hash.update(contents);
  }
  return hash.digest("hex");
}

function hashDir(dir) {
  return hashFiles((file) => {
    const path = join(dir, file);
    return existsSync(path) ? readFileSync(path) : null;
  });
}

function hashStub() {
  return hashFiles((file) => {
    const value = stubFiles[file];
    return typeof value === "string" ? Buffer.from(value) : value;
  });
}

function invalidateViteCache() {
  rmSync(join(viteDepsDir, "ironsmith-wasm.js"), { force: true });
  rmSync(join(viteDepsDir, "ironsmith-wasm.js.map"), { force: true });
  rmSync(join(viteDepsDir, "_metadata.json"), { force: true });
}

const realHash = existsSync(sourceDir) ? hashDir(sourceDir) : null;
const useReal = realHash !== null;
const desiredHash = useReal ? realHash : hashStub();
const targetHash = existsSync(targetDir) ? hashDir(targetDir) : null;

if (desiredHash === targetHash) {
  console.log(`[sync-ironsmith] ironsmith-wasm is current (${useReal ? "built pkg" : "stub"}).`);
  process.exit(0);
}

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });

if (useReal) {
  cpSync(sourceDir, targetDir, { recursive: true });
  invalidateViteCache();
  console.log("[sync-ironsmith] copied ironsmith/pkg into node_modules/ironsmith-wasm.");
} else {
  mkdirSync(targetDir, { recursive: true });
  for (const [file, contents] of Object.entries(stubFiles)) {
    writeFileSync(join(targetDir, file), contents);
  }
  invalidateViteCache();
  console.warn(
    "[sync-ironsmith] ironsmith/pkg not found; wrote a stub ironsmith-wasm package. " +
      "The Ironsmith runtime stays disabled until the submodule is built and synced.",
  );
}
