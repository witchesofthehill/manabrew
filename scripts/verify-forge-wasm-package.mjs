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
  "engine.js",
  "node.js",
  "node-worker.cjs",
  "stamp.js",
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

// A stubbed build skips the checks that read the engine, and says so.
// Everything after this point runs either way.
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

// A mismatch means the stamp did not run, and consumers would read stale
// numbers.
const stamps = readFileSync(join(packageDir, "stamp.js"), "utf8");
const stampOf = (name) => stamps.match(new RegExp(`^export const ${name} = "(.*)";$`, "m"))?.[1];

const manifestVersion = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version;
if (stampOf("VERSION") !== manifestVersion) {
  throw new Error(
    `stamp.js exports VERSION ${stampOf("VERSION")}, manifest says ${manifestVersion}.`,
  );
}

const cardsetArchiveVersion = readFileSync(
  join(root, "manabrew-rs", "crates", "forge-cardset-archive", "Cargo.toml"),
  "utf8",
).match(/^version\s*=\s*"(.+)"$/m)?.[1];
if (stampOf("CARDSET_ARCHIVE_VERSION") !== cardsetArchiveVersion) {
  throw new Error(
    `stamp.js exports CARDSET_ARCHIVE_VERSION ${stampOf("CARDSET_ARCHIVE_VERSION")}, the crate is ${cardsetArchiveVersion}.`,
  );
}
if (!/^[0-9a-f]{40}$/.test(stampOf("BUILD_COMMIT") ?? "")) {
  throw new Error(`stamp.js exports BUILD_COMMIT ${stampOf("BUILD_COMMIT")}, expected a commit.`);
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
    'import { ForgeEngine, VERSION, CARDSET_ARCHIVE_VERSION, BUILD_COMMIT } from "@manabrew/forge-wasm";',
    'import type { ForgeDeck } from "@manabrew/forge-wasm";',
    'import { deckCardNames } from "@manabrew/forge-wasm/deckCards";',
    'import { createSeat, SAB_SIZE } from "@manabrew/forge-wasm/seat";',
    'import type { Deck, GameViewDto, Prompt } from "@manabrew/protocol";',
    "const build: string[] = [VERSION, CARDSET_ARCHIVE_VERSION, BUILD_COMMIT];",
    "void build;",
    // A deck with every zone filled has to satisfy ForgeDeck: dropping a zone
    // from the type would silently narrow every bundle.
    'const deck = { cards: [{ identity: { name: "Lightning Bolt" } }], sideboard: [], attractions: [],',
    "  contraptions: [], schemes: [], planes: [], commanders: [], companion: undefined };",
    "void deckCardNames([deck]);",
    "void createSeat(new SharedArrayBuffer(SAB_SIZE));",
    // A protocol Deck has to be usable as a ForgeDeck, or a caller holding one
    // from the relay would have to rebuild it to start a game.
    "const fromProtocol: ForgeDeck = null as unknown as Deck;",
    "void fromProtocol;",
    // The callbacks must hand back protocol types, not opaque blobs: these
    // annotations do not compile if the package types them as unknown.
    "const engine = new ForgeEngine({",
    '  assets: "",',
    "  onState: (state) => { const view: GameViewDto = state.gameView; void view; },",
    "  onPrompt: (prompt) => { const p: Prompt = prompt; void p; },",
    '  onDisplay: (event) => { void (event.kind === "cardPlayed" ? event.cardName : ""); },',
    "});",
    "void engine.startGame({ deck });",
    'engine.respond(1, { type: "chooseBoolean", output: { type: "decision", value: true } });',
    'engine.directive({ type: "concede" });',
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

// The browser entry is bundler-only: its `?url` imports do not resolve outside
// one. The `node` condition has to keep pointing at an entry Node can load, and
// with a real engine it has to actually play a game.
writeFileSync(
  join(consumer, "node-usage.mjs"),
  [
    'import { createForgeEngine, ForgeEngine, VERSION } from "@manabrew/forge-wasm";',
    'if (typeof ForgeEngine !== "function") throw new Error("the node entry exports no ForgeEngine.");',
    'if (!VERSION) throw new Error("the node entry exports no VERSION.");',
    'if (process.argv.includes("--import-only")) {',
    "  console.log(`Node entry loads: @manabrew/forge-wasm ${VERSION}`);",
    "  process.exit(0);",
    "}",
    "",
    "const copies = (name, count) => Array.from({ length: count }, () => ({ name }));",
    'const deck = { format: "constructed", cards: [...copies("Mountain", 24), ...copies("Raging Goblin", 36)] };',
    "",
    // Pass on everything. The AI wins in a couple of seconds, and what is under
    // test is the packaging, not the rules.
    "const REPLIES = {",
    "  mulligan: () => ({ keep: true }),",
    "  mulliganPutBack: () => ({ cardIds: [] }),",
    "  diceRolled: () => ({}),",
    "  revealCards: () => ({}),",
    '  chooseAction: () => ({ type: "pass" }),',
    "  chooseBoolean: () => ({ value: false }),",
    "  chooseCards: () => ({ chosenCardIds: [] }),",
    "  chooseAttackers: () => ({ assignments: [] }),",
    "  chooseBlockers: () => ({ assignments: [] }),",
    "};",
    "",
    "// The worker forwards its whole console, which is where a boot failure",
    "// explains itself. Keep the tail of it to print if one happens.",
    "const logs = [];",
    "const die = (message) => {",
    '  console.error([...logs.slice(-20), message].join("\\n"));',
    "  process.exit(1);",
    "};",
    "let prompts = 0;",
    "let states = 0;",
    'const timer = setTimeout(() => die("Forge did not finish a game in 300s."), 300_000);',
    "",
    "const engine = await createForgeEngine({",
    "  onState: () => { states += 1; },",
    "  onPrompt: (prompt) => {",
    "    prompts += 1;",
    "    const type = prompt.input?.type;",
    "    const reply = REPLIES[type];",
    "    if (reply) engine.respond(prompt.promptId, { type, output: reply(prompt) });",
    '    else engine.directive({ type: "concede" });',
    "  },",
    "  onError: (error) => die(`Forge reported an error: ${JSON.stringify(error)}`),",
    "  onEvent: (event, payload) => {",
    '    if (event === "forge:log") logs.push(payload.text);',
    '    if (event === "game:forced_end") die(`Forge ended the game early: ${JSON.stringify(payload)}`);',
    '    if (event !== "game:over") return;',
    "    clearTimeout(timer);",
    "    if (!prompts || !states) die(`Forge ended after ${prompts} prompts and ${states} states.`);",
    "    console.log(`Node entry played a game: ${prompts} prompts, ${states} states.`);",
    "    engine.dispose();",
    "    process.exit(0);",
    "  },",
    "});",
    "",
    "await engine.startGame({ deck, opponentDecks: [deck] });",
    "",
  ].join("\n"),
);
process.stdout.write(
  run(
    process.execPath,
    stubEngine
      ? [join(consumer, "node-usage.mjs"), "--import-only"]
      : [join(consumer, "node-usage.mjs")],
    consumer,
  ),
);

console.log(
  `Verified ${basename(tarball)}: ${(packed.size / 1024 / 1024).toFixed(1)} MiB tarball, ${packed.files.length} files.` +
    (stubEngine ? " Engine stubbed — do not publish this build." : ""),
);
