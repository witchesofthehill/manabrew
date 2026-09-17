#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const presets = join(root, "public", "preset_decks");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

function loadDeck(name) {
  const path = name.endsWith(".json") ? resolve(name) : join(presets, `${name}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const card = (entry) => ({
    name: entry.name,
    setCode: entry.set,
    cardNumber: entry.cardNumber,
    count: entry.count ?? 1,
  });
  const commander = raw.cards.find((entry) => entry.name === raw.commander);
  if (!commander) throw new Error(`${name}: commander ${raw.commander} is missing`);
  return {
    name: raw.label,
    format: raw.format,
    commanders: [{ ...card(commander), count: 1 }],
    cards: raw.cards.flatMap((entry) =>
      entry.name === raw.commander
        ? entry.count > 1
          ? [{ ...card(entry), count: entry.count - 1 }]
          : []
        : [card(entry)],
    ),
  };
}

const engineDir = resolve(option("engine", join(root, "packages", "forge-wasm")));
const wasmDir = resolve(option("wasm", join(root, "src", "wasm")));
const deckNames = option(
  "decks",
  "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
).split(",");
const seed = Number(option("seed", 7015));
const timeoutS = Number(option("timeout", 300));
const output = option("out", null);

if (!existsSync(join(engineDir, "forgeharness.js.wasm"))) {
  throw new Error(`${engineDir} has no Forge WASM engine`);
}
if (!existsSync(join(wasmDir, "wasm_bg.wasm"))) {
  throw new Error(`${wasmDir} has no Manabrew WASM build; run yarn ensure:wasm`);
}

const { createForgeEngine } = await import(pathToFileURL(join(engineDir, "node.js")).href);
const manabrew = await import(pathToFileURL(join(wasmDir, "wasm.js")).href);
await manabrew.default({ module_or_path: readFileSync(join(wasmDir, "wasm_bg.wasm")) });

const decks = deckNames.map(loadDeck);
const bots = decks.map(() => new manabrew.WasmManabot());
const seats = bots.map(() => ({
  prompts: 0,
  acts: 0,
  casts: 0,
  landPlays: 0,
  abilities: 0,
  passes: 0,
  attackers: 0,
  blocks: 0,
  mulligans: 0,
}));
const intervals = [];
let turn = 0;
let finalView = null;
let lastResponseAt = null;
let finish;
const startedAt = performance.now();
const ended = new Promise((resolve) => {
  finish = resolve;
});

const engine = await createForgeEngine({
  onState: (state, slot) => {
    const seat = slot ? Number(slot.slice("player-".length)) : 0;
    bots[seat].observe_state(JSON.stringify(state));
    if (!slot) finalView = state?.gameView ?? finalView;
    if (typeof state?.gameView?.turn === "number") turn = state.gameView.turn;
  },
  onPrompt: (prompt, slot) => {
    const seat = slot ? Number(slot.slice("player-".length)) : 0;
    const now = performance.now();
    if (lastResponseAt !== null) intervals.push(now - lastResponseAt);
    seats[seat].prompts += 1;
    const raw = bots[seat].decide(JSON.stringify(prompt));
    if (!raw) return;
    const action = JSON.parse(raw);
    const decision = action.output;
    if (decision?.type === "act") {
      seats[seat].acts += 1;
      const chosen = (prompt.input.actions ?? []).find(
        (candidate) => candidate.id === decision.actionId,
      );
      if (chosen?.type === "cast") {
        seats[seat].casts += 1;
        if ((chosen.label ?? "").startsWith("Play ")) seats[seat].landPlays += 1;
      } else {
        seats[seat].abilities += 1;
      }
    }
    if (decision?.type === "pass") seats[seat].passes += 1;
    if (decision?.type === "declareAttackers") {
      seats[seat].attackers += decision.assignments?.length ?? 0;
    }
    if (decision?.type === "declareBlockers") {
      seats[seat].blocks += decision.assignments?.length ?? 0;
    }
    if (decision?.type === "mulliganDecision" && !decision.keep) seats[seat].mulligans += 1;
    lastResponseAt = performance.now();
    engine.respond(prompt.promptId, action, slot || undefined);
  },
  onError: (error, slot) => finish({ reason: "error", error: String(error), slot }),
  onEvent: (event, payload) => {
    if (event === "game:over" || event === "game:forced_end") {
      finish({ reason: event, payload });
    }
  },
});

await engine.startMultiplayerGame({
  decks,
  playerNames: decks.map((_, index) => `Manabot ${index + 1}`),
  commanderNames: decks.map((deck) => deck.commanders[0].name),
  enginePlayerIndex: 0,
  startingLife: 40,
  seed,
});

const outcome = await Promise.race([
  ended,
  new Promise((resolve) => setTimeout(() => resolve({ reason: "timeout" }), timeoutS * 1000)),
]);
const sorted = intervals.toSorted((left, right) => left - right);
const percentile = (value) =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))];
const summary = {
  seed,
  decks: deckNames,
  outcome,
  durationMs: Math.round(performance.now() - startedAt),
  turn,
  winnerId: finalView?.winnerId ?? null,
  players: finalView?.players ?? [],
  seats,
  latency: {
    samples: sorted.length,
    p50: Math.round(percentile(0.5)),
    p90: Math.round(percentile(0.9)),
    p99: Math.round(percentile(0.99)),
    max: Math.round(sorted.at(-1) ?? 0),
    over1s: sorted.filter((value) => value > 1000).length,
  },
};

const text = `${JSON.stringify(summary, null, 2)}\n`;
if (output) writeFileSync(output, text);
process.stdout.write(text);
engine.dispose();
for (const bot of bots) bot.free();
process.exit(outcome.reason === "game:over" ? 0 : 1);
