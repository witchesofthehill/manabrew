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
  const commandNames = [raw.commander, raw.signatureSpell].filter(Boolean);
  const commandCards = commandNames.map((commandName) => {
    const entry = raw.cards.find((candidate) => candidate.name === commandName);
    if (!entry) throw new Error(`${name}: command-zone card ${commandName} is missing`);
    return entry;
  });
  return {
    name: raw.label,
    format: raw.format,
    commanders: commandCards.map((entry) => ({ ...card(entry), count: 1 })),
    cards: raw.cards.flatMap((entry) =>
      commandNames.includes(entry.name)
        ? entry.count > 1
          ? [{ ...card(entry), count: entry.count - 1 }]
          : []
        : [card(entry)],
    ),
  };
}

const engineDir = resolve(option("engine", join(root, "packages", "forge-wasm")));
const wasmDir = resolve(option("wasm", join(root, "src", "wasm")));
const wasmOptions = option("wasms", wasmDir)
  .split(",")
  .map((path) => resolve(path));
const deckNames = option(
  "decks",
  "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
).split(",");
const seed = Number(option("seed", 7015));
const forgeAiSeats = option("forge-ai-seats", "").split(",").filter(Boolean).map(Number);
const timeoutS = Number(option("timeout", 300));
const output = option("out", null);

if (!existsSync(join(engineDir, "forgeharness.js.wasm"))) {
  throw new Error(`${engineDir} has no Forge WASM engine`);
}
for (const path of wasmOptions) {
  if (!existsSync(join(path, "wasm_bg.wasm"))) {
    throw new Error(`${path} has no Manabrew WASM build; run yarn ensure:wasm`);
  }
}

const { createForgeEngine } = await import(pathToFileURL(join(engineDir, "node.js")).href);
const modules = new Map();
for (const path of new Set(wasmOptions)) {
  const module = await import(pathToFileURL(join(path, "wasm.js")).href);
  await module.default({ module_or_path: readFileSync(join(path, "wasm_bg.wasm")) });
  modules.set(path, module);
}

const decks = deckNames.map(loadDeck);
const formats = new Set(decks.map((deck) => deck.format));
if (formats.size !== 1) {
  throw new Error(`all decks must use the same format, got ${[...formats]}`);
}
const format = decks[0].format;
const defaultStartingLife =
  format === "commander" ? 40 : format === "historicBrawl" ? 25 : 20;
const startingLife = Number(option("starting-life", defaultStartingLife));
const botSources = wasmOptions.length === 1 ? decks.map(() => wasmOptions[0]) : wasmOptions;
if (botSources.length !== decks.length) {
  throw new Error(`--wasms must contain one path or one path per seat`);
}
const bots = botSources.map((path) => new (modules.get(path).WasmManabot)());
const enginePlayerIndex = decks.findIndex((_, index) => !forgeAiSeats.includes(index));
if (enginePlayerIndex < 0) throw new Error("at least one external Manabot seat is required");
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
  promptTypes: {},
  actionLabels: {},
  booleanChoices: {},
  boardTargetChoices: {},
  cardSelections: {},
  selectionChoices: {},
  numberChoices: {},
  paymentAutoAttempts: 0,
  paymentConfirms: 0,
  paymentCancels: 0,
  failedCastLabels: {},
}));
const latestViews = decks.map(() => null);
const pendingCastLabels = decks.map(() => null);

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}
const intervals = [];
let turn = 0;
let finalView = null;
let lastResponseAt = null;
const terminalPrompts = [];
let finish;
const startedAt = performance.now();
const ended = new Promise((resolve) => {
  finish = resolve;
});

const engine = await createForgeEngine({
  onState: (state, slot) => {
    const seat = slot ? Number(slot.slice("player-".length)) : enginePlayerIndex;
    bots[seat].observe_state?.(JSON.stringify(state));
    latestViews[seat] = state?.gameView ?? latestViews[seat];
    if (!slot) finalView = state?.gameView ?? finalView;
    if (typeof state?.gameView?.turn === "number") turn = state.gameView.turn;
  },
  onPrompt: (prompt, slot) => {
    const seat = slot ? Number(slot.slice("player-".length)) : enginePlayerIndex;
    const now = performance.now();
    if (lastResponseAt !== null) intervals.push(now - lastResponseAt);
    seats[seat].prompts += 1;
    increment(seats[seat].promptTypes, prompt.input?.type ?? prompt.type ?? "unknown");
    if (prompt.input?.type === "gameOver") terminalPrompts.push({ seat, input: prompt.input });
    const raw = bots[seat].decide(JSON.stringify(prompt));
    if (!raw) return;
    const action = JSON.parse(raw);
    const decision = action.output;
    if (decision?.type === "act") {
      seats[seat].acts += 1;
      const chosen = (prompt.input.actions ?? []).find(
        (candidate) => candidate.id === decision.actionId,
      );
      const actionLabel = chosen?.label ?? chosen?.description;
      if (actionLabel) increment(seats[seat].actionLabels, actionLabel);
      if (chosen?.type === "cast") {
        seats[seat].casts += 1;
        pendingCastLabels[seat] = chosen.label ?? chosen.cardId ?? "unknown cast";
        if ((chosen.label ?? "").startsWith("Play ")) seats[seat].landPlays += 1;
      } else {
        seats[seat].abilities += 1;
      }
    }
    if (decision?.type === "pass") seats[seat].passes += 1;
    if (prompt.input?.type === "payManaCost" && decision?.type === "pay" && decision.auto) {
      seats[seat].paymentAutoAttempts += 1;
    }
    if (prompt.input?.type === "payManaCost" && decision?.type === "pay" && !decision.auto) {
      seats[seat].paymentConfirms += 1;
      pendingCastLabels[seat] = null;
    }
    if (prompt.input?.type === "payManaCost" && decision?.type === "cancel") {
      seats[seat].paymentCancels += 1;
      increment(seats[seat].failedCastLabels, pendingCastLabels[seat] ?? "unknown payment");
      pendingCastLabels[seat] = null;
    }
    if (decision?.type === "declareAttackers") {
      seats[seat].attackers += decision.assignments?.length ?? 0;
    }
    if (decision?.type === "declareBlockers") {
      seats[seat].blocks += decision.assignments?.length ?? 0;
    }
    if (decision?.type === "mulliganDecision" && !decision.keep) seats[seat].mulligans += 1;
    if (decision?.type === "decision" && typeof decision.value === "boolean") {
      const title = prompt.input.presentation?.title ?? "untitled";
      increment(seats[seat].booleanChoices, `${title}: ${decision.value}`);
    }
    if (decision?.type === "selectionDecision") {
      const title = prompt.input.presentation?.title ?? "untitled";
      const labels = (decision.chosenIndices ?? []).map(
        (index) => prompt.input.options?.[index]?.label ?? `option ${index}`,
      );
      increment(seats[seat].selectionChoices, `${title}: ${labels.join(" | ") || "none"}`);
    }
    if (decision?.type === "numberDecision") {
      const title = prompt.input.presentation?.title ?? "untitled";
      increment(
        seats[seat].numberChoices,
        `${title}: ${decision.chosenNumber ?? "none"}/${prompt.input.min}-${prompt.input.max}`,
      );
    }
    if (decision?.type === "chooseCardsDecision") {
      const title = prompt.input.presentation?.title ?? "untitled";
      const count = decision.chosenCardIds?.length ?? 0;
      increment(
        seats[seat].cardSelections,
        `${title}: ${count}/${prompt.input.min ?? 0}-${prompt.input.max ?? 0}`,
      );
    }
    if (decision?.type === "boardTargets") {
      for (const chosen of decision.chosen ?? []) {
        const target = (prompt.input.candidates ?? []).find((value) => value.id === chosen.id);
        let side = "unknown";
        if (target?.kind === "player") side = target.id === `player-${seat}` ? "own" : "opponent";
        if (target?.kind === "card") {
          const card = (latestViews[seat]?.zones ?? [])
            .flatMap((zone) => zone.cards ?? [])
            .find((value) => value.id === target.id);
          if (card?.controllerId)
            side = card.controllerId === `player-${seat}` ? "own" : "opponent";
        }
        const intent =
          target?.intent ?? prompt.input.intent ?? (prompt.input.hostile ? "hostile" : "none");
        increment(seats[seat].boardTargetChoices, `${intent}:${side}`);
      }
    }
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
  commanderNames: decks.map((deck) => deck.commanders[0]?.name ?? null),
  enginePlayerIndex,
  forgeAiSeats,
  startingLife,
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
  format,
  startingLife,
  decks: deckNames,
  agents: botSources.map((source, index) => (forgeAiSeats.includes(index) ? "forge-ai" : source)),
  outcome,
  durationMs: Math.round(performance.now() - startedAt),
  turn,
  winnerId: finalView?.winnerId ?? null,
  players: finalView?.players ?? [],
  terminalPrompts,
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
