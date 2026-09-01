#!/usr/bin/env node
/**
 * Plays a whole Forge game headlessly against `@manabrew/forge-wasm` and records
 * what each decision cost.
 *
 * The browser is not needed to measure the engine, and it hides more than it
 * shows: `tests/e2e-ui/forge-wasm-latency.mjs` drives the real UI, so its
 * numbers are quantised by the render loop and a run costs a browser. This
 * drives the package's Node entry instead, which is the same engine on the same
 * worker with nothing in front of it.
 *
 * The human seat passes on every priority. That is deliberate: it leaves the AI
 * seats doing all the work, so a reading is the engine's cost and not a
 * scripted line of play. Seat count is the variable worth sweeping — four-seat
 * Commander is where the stalls live (#817).
 *
 * Two numbers per decision, the same two the client reports:
 *   - turnaround, answer sent to next prompt landing, measured here;
 *   - the engine's own `forge:decision`, measured inside the engine, tagged
 *     with how many opponent turns fell inside the window.
 * Read the same-turn half. The cross-turn half contains whole AI turns and is
 * not one decision, which is written up in `docs/agents/LATENCY_ANALYSIS.md`.
 *
 * Under `--trace-gc` the collector's lines interleave with the JSONL, which is
 * what separates a GC pause from a slow AI search. The engine's Java heap is
 * the host's: the Web Image build targets WasmGC and declares no linear memory,
 * so there is no engine-side heap to cap or to blame.
 *
 *   node scripts/engine-bench/forge-wasm-game.mjs --seats 4 --out game.jsonl
 *   node --trace-gc scripts/engine-bench/forge-wasm-game.mjs --seats 4 > game.log
 *
 * Then: python3 scripts/engine-bench/summarise.py 'game*.jsonl'
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createForgeEngine, BUILD_COMMIT, VERSION } from "@manabrew/forge-wasm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRESETS = join(root, "public", "preset_decks");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const seats = Number(option("seats", 4));
const timeoutS = Number(option("timeout", 1800));
const out = option("out", `forge-wasm-${seats}seat.jsonl`);
const deckNames = option(
  "decks",
  "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
).split(",");

/**
 * A preset as a `ForgeDeck`. The commander has to move out of the 99 and into
 * its own zone: the worker reads each seat's commanders from `deck.commanders`
 * and only falls back to the `commanderName` argument for the human seat, so an
 * opponent whose commander stayed in `cards` plays a 100-card pile with an empty
 * command zone.
 */
function loadDeck(basename) {
  const raw = JSON.parse(readFileSync(join(PRESETS, `${basename}.json`), "utf8"));
  const card = (c) => ({
    name: c.name,
    setCode: c.set,
    cardNumber: c.cardNumber,
    count: c.count ?? 1,
  });
  const isCommander = (c) => c.name === raw.commander;
  const commander = raw.cards.find(isCommander);
  if (!commander) throw new Error(`${basename}: commander "${raw.commander}" is not in the deck`);
  return {
    name: raw.label,
    format: raw.format,
    commanders: [{ ...card(commander), count: 1 }],
    cards: raw.cards.flatMap((c) =>
      isCommander(c) ? (c.count > 1 ? [{ ...card(c), count: c.count - 1 }] : []) : [card(c)],
    ),
  };
}

/**
 * Every prompt the human seat can be asked, answered with the cheapest legal
 * nothing. Minimums are honoured: Forge throws `selected card count out of
 * range` and ends the game if a prompt with a minimum is answered with none,
 * which reads as a clean early `game:over` rather than as an error.
 */
const REPLIES = {
  mulligan: () => ({ type: "mulliganDecision", keep: true }),
  mulliganPutBack: (p) => ({
    type: "mulliganPutBackDecision",
    cardIds: (p.input.handCardIds || []).slice(0, p.input.count || 0),
  }),
  diceRolled: () => ({ type: "diceRolledAcknowledged" }),
  revealCards: () => ({ type: "revealCardsAcknowledged" }),
  chooseAction: () => ({ type: "pass" }),
  chooseBoolean: () => ({ type: "decision", value: false }),
  chooseCards: (p) => ({
    type: "chooseCardsDecision",
    chosenCardIds: (p.input.cards || []).map((c) => c.id).slice(0, p.input.min || 0),
  }),
  chooseAttackers: () => ({ type: "declareAttackers", assignments: [] }),
  chooseBlockers: () => ({ type: "declareBlockers", assignments: [] }),
  chooseBoardTargets: (p) => ({
    type: "boardTargets",
    chosen: (p.input.candidates || []).slice(0, Math.max(0, p.input.minTargets || 0)),
  }),
  chooseColor: (p) => ({
    type: "colorDecision",
    chosenColors: { [(p.input.validColors || ["W"])[0]]: p.input.amount ?? 1 },
  }),
  chooseNumber: (p) => ({ type: "numberDecision", chosenNumber: p.input.min ?? 0 }),
  chooseFromSelection: (p) => {
    const options = p.input.options || [];
    const chosen = [];
    let total = 0;
    for (let i = 0; i < options.length && total < (p.input.minTotal || 0); i += 1) {
      chosen.push(i);
      total += options[i].weight ?? 1;
    }
    return { type: "selectionDecision", chosenIndices: chosen };
  },
  chooseCombatDamageAssignment: (p) => {
    const target = (p.input.blockerIds || [])[0] ?? p.input.defenderId;
    return {
      type: "combatDamageAssignmentDecision",
      assignments: target ? [{ assigneeId: target, damage: p.input.totalDamage ?? 0 }] : [],
    };
  },
  chooseDamageAssignmentOrder: (p) => ({
    type: "damageAssignmentOrderDecision",
    orderedBlockerIds: p.input.blockerIds || [],
  }),
  scry: (p) => ({
    type: "scryDecision",
    zoneCardIds: (p.input.zones || []).map((_, i) =>
      i === 0 ? (p.input.cards || []).map((c) => c.id) : [],
    ),
  }),
  reorder: (p) => ({ type: "reorderDecision", orderedIds: (p.input.items || []).map((i) => i.id) }),
  payManaCost: () => ({ type: "cancel" }),
};

const decks = Array.from({ length: seats }, (_, i) => loadDeck(deckNames[i % deckNames.length]));
const startedAt = Date.now();
const rows = [];
// `up` is process uptime, which is the clock `--trace-gc` prints against, so a
// stall and the collector's lines can be lined up without a second run.
const note = (row) => {
  const line = JSON.stringify({
    t: Date.now() - startedAt,
    up: Math.round(process.uptime() * 1000),
    ...row,
  });
  rows.push(row);
  appendFileSync(out, `${line}\n`);
};

writeFileSync(out, "");
note({
  ev: "start",
  version: VERSION,
  commit: BUILD_COMMIT,
  seats,
  decks: deckNames.slice(0, seats),
});

let answeredAt = null;
let prompts = 0;
let turn = 0;
const logs = [];

function summarise() {
  const decisions = rows.filter((r) => r.ev === "decision");
  const q = (xs, p) =>
    xs.length
      ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]
      : 0;
  console.log("\ntype                     n  same_p50  same_p90  same_max  cross_p50  cross_max");
  const types = [...new Set(decisions.map((r) => r.type))];
  for (const type of types.sort(
    (a, b) =>
      decisions.filter((r) => r.type === b).length - decisions.filter((r) => r.type === a).length,
  )) {
    const list = decisions.filter((r) => r.type === type);
    const same = list.filter((r) => !r.turns).map((r) => r.ms);
    const cross = list.filter((r) => r.turns).map((r) => r.ms);
    console.log(
      type.padEnd(20) +
        String(list.length).padStart(6) +
        [q(same, 50), q(same, 90), q(same, 100), q(cross, 50), q(cross, 100)]
          .map((v) => String(v).padStart(10))
          .join(""),
    );
  }
}

function finish(why) {
  note({ ev: "end", why, prompts, turn, tail: logs.slice(-30) });
  console.log(
    `\n${why}: ${prompts} prompts over ${((Date.now() - startedAt) / 1000).toFixed(0)}s, turn ${turn}`,
  );
  if (why !== "game:over") console.log(`forge log tail:\n  ${logs.slice(-25).join("\n  ")}`);
  summarise();
  process.exit(why === "game:over" ? 0 : 1);
}

setTimeout(() => finish("timeout"), timeoutS * 1000).unref();

const engine = await createForgeEngine({
  onState: (state) => {
    const at = state?.gameView?.turn;
    if (typeof at === "number") turn = at;
  },
  onPrompt: (prompt) => {
    prompts += 1;
    const type = prompt.input?.type;
    if (answeredAt !== null) {
      note({ ev: "turnaround", type, ms: Date.now() - answeredAt, turn });
      answeredAt = null;
    }
    const reply = REPLIES[type];
    if (!reply) {
      note({ ev: "unhandled", type, prompt: JSON.stringify(prompt).slice(0, 400) });
      engine.directive({ type: "concede" });
      return;
    }
    answeredAt = Date.now();
    engine.respond(prompt.promptId, { type, output: reply(prompt) });
  },
  onError: (error) => note({ ev: "error", error: JSON.stringify(error).slice(0, 300) }),
  onEvent: (event, payload) => {
    if (event === "forge:decision") {
      note({ ev: "decision", ...payload, turn });
      if (payload.ms > 5000) {
        console.log(`  stall ${payload.ms}ms ${payload.type} turns=${payload.turns} @turn ${turn}`);
      }
      return;
    }
    if (event === "forge:log") logs.push(payload.text);
    if (event === "game:forced_end") finish("game:forced_end");
    if (event === "game:over") finish("game:over");
  },
});

note({ ev: "booted" });
await engine.startGame({
  deck: decks[0],
  opponentDecks: decks.slice(1),
  commanderName: decks[0].commanders[0].name,
});
note({ ev: "started" });
