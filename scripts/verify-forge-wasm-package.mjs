#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = join(root, "target", "npm", "forge-wasm");
const temporary = mkdtempSync(join(tmpdir(), "forge-wasm-package-"));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

const required = [
  "forge.js",
  "forge.d.ts",
  "deckCards.js",
  "deckCards.d.ts",
  "seat.js",
  "seat.d.ts",
  "vite.js",
  "vite.d.ts",
  "forge-assets.js",
  "forge-assets_bg.wasm",
  "forge-engine.worker.js",
  "forgeharness.js",
  "forgeharness.js.wasm",
  "cardset.rkyv",
  "README.md",
  "LICENSE",
];
for (const file of required) statSync(join(packageDir, file));

// `--stub-engine` builds carry placeholders where the two GraalVM outputs go,
// so the checks that read them are skipped and said out loud. Everything after
// this point runs either way.
const stubEngine = existsSync(join(packageDir, ".stub-engine"));
if (stubEngine) {
  console.log("Engine stubbed: skipping the engine size and launcher-pin checks.");
} else {
  if (statSync(join(packageDir, "forgeharness.js.wasm")).size < 30_000_000) {
    throw new Error("Forge engine WASM is unexpectedly small.");
  }
  if (!readFileSync(join(packageDir, "forgeharness.js"), "utf8").includes("__forgeWasmUrl")) {
    throw new Error("Forge launcher does not honour the package WASM URL.");
  }
}
if (statSync(join(packageDir, "cardset.rkyv")).size < 30_000_000) {
  throw new Error("Forge cardset is unexpectedly small.");
}

// The runtime exports are stamped at build time; a mismatch means the stamp
// did not run and consumers would read stale numbers.
const entry = readFileSync(join(packageDir, "forge.js"), "utf8");
const stampOf = (name) => entry.match(new RegExp(`^export const ${name} = "(.*)";$`, "m"))?.[1];

const manifestVersion = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
if (stampOf("VERSION") !== manifestVersion) {
  throw new Error(
    `forge.js exports VERSION ${stampOf("VERSION")}, manifest says ${manifestVersion}.`,
  );
}

// The selector in the package has to name the crate release it came from, or a
// bug report cannot say which selection rules it hit.
const cardsetArchiveVersion = readFileSync(
  join(root, "manabrew-rs", "crates", "forge-cardset-archive", "Cargo.toml"),
  "utf8",
).match(/^version\s*=\s*"(.+)"$/m)?.[1];
if (stampOf("CARDSET_ARCHIVE_VERSION") !== cardsetArchiveVersion) {
  throw new Error(
    `forge.js exports CARDSET_ARCHIVE_VERSION ${stampOf("CARDSET_ARCHIVE_VERSION")}, the crate is ${cardsetArchiveVersion}.`,
  );
}
if (!/^[0-9a-f]{40}$/.test(stampOf("BUILD_COMMIT") ?? "")) {
  throw new Error(`forge.js exports BUILD_COMMIT ${stampOf("BUILD_COMMIT")}, expected a commit.`);
}

const packed = JSON.parse(
  run("npm", ["pack", "--json", "--pack-destination", temporary], packageDir),
)[0];
const packedNames = new Set(packed.files.map((file) => file.path));
for (const file of required) {
  if (!packedNames.has(file)) throw new Error(`${file} is absent from npm pack output.`);
}
if ([...packedNames].some((file) => file.endsWith(".wat"))) {
  throw new Error("npm package contains a WebAssembly text dump.");
}
if (packedNames.has(".stub-engine")) {
  throw new Error("npm package carries the stub-engine marker.");
}

const consumer = join(temporary, "consumer");
run("mkdir", ["-p", consumer]);
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify({
    type: "module",
    dependencies: {
      "@manabrew/forge-wasm": "file:../package.tgz",
      typescript: "^5.9.3",
      vite: "^7.3.5",
    },
  }),
);
writeFileSync(join(consumer, "index.html"), '<script type="module" src="/src.js"></script>\n');
writeFileSync(
  join(consumer, "vite.config.js"),
  'import { forgeWasm } from "@manabrew/forge-wasm/vite"; export default { plugins: [forgeWasm()] };\n',
);
writeFileSync(
  join(consumer, "src.js"),
  'import { ForgeEngine, VERSION } from "@manabrew/forge-wasm"; console.log(ForgeEngine, VERSION);\n',
);
writeFileSync(
  join(consumer, "usage.ts"),
  [
    // The subpath exports carry their own types, and a deck object with every
    // zone filled has to satisfy ForgeDeck — the zones are what the selector
    // reads, so dropping one from the type would silently narrow a bundle.
    'import { ForgeEngine, VERSION, CARDSET_ARCHIVE_VERSION, BUILD_COMMIT } from "@manabrew/forge-wasm";',
    'import { deckCardNames } from "@manabrew/forge-wasm/deckCards";',
    'import { createSeat, SAB_SIZE } from "@manabrew/forge-wasm/seat";',
    "const build: string[] = [VERSION, CARDSET_ARCHIVE_VERSION, BUILD_COMMIT];",
    "void build;",
    'const deck = { cards: [{ identity: { name: "Lightning Bolt" } }], sideboard: [], attractions: [],',
    "  contraptions: [], schemes: [], planes: [], commanders: [], companion: undefined };",
    'const engine = new ForgeEngine({ assets: "" });',
    "void engine.startGame({ deck });",
    'engine.directive({ kind: "concede" });',
    "void deckCardNames([deck]);",
    "void createSeat(new SharedArrayBuffer(SAB_SIZE));",
    "",
  ].join("\n"),
);
writeFileSync(
  join(consumer, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      lib: ["DOM", "ES2022"],
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
    },
    files: ["usage.ts"],
  }),
);
const tarball = join(temporary, packed.filename);
run("cp", [tarball, join(temporary, "package.tgz")]);
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], consumer);
run(
  process.execPath,
  [join(consumer, "node_modules", "typescript", "bin", "tsc"), "--noEmit"],
  consumer,
);
run(
  process.execPath,
  [join(consumer, "node_modules", "vite", "bin", "vite.js"), "build"],
  consumer,
);

const assets = readdirSync(join(consumer, "dist", "assets"));
for (const expected of ["forge-engine.worker", "forgeharness", "cardset", "forge-assets_bg"]) {
  if (!assets.some((file) => file.includes(expected))) {
    throw new Error(`Vite did not emit the ${expected} package asset: ${assets.join(", ")}`);
  }
}

console.log(
  `Verified ${basename(tarball)}: ${(packed.size / 1024 / 1024).toFixed(1)} MiB tarball, ${packed.files.length} files.` +
    (stubEngine ? " Engine stubbed — do not publish this build." : ""),
);
