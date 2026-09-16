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
 *
 * `--policy greedy` plays the human seat instead of passing: a land a turn, the
 * first castable spell, every creature attacks. It is not a player, it is a way
 * to put the human's permanents on the board so the AI has more to look at.
 * `--engine <dir>` loads the package from a directory holding a local
 * `build:forge-wasm` output instead of the installed npm package. `--games N`
 * plays N games in one engine, which is how a browser tab behaves, and samples
 * the host heap between games. `--seed` pins the shuffle. `stress.mjs` drives
 * all of this across a matrix.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PRESETS = join(root, "public", "preset_decks");

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const seats = Number(option("seats", 4));
const timeoutS = Number(option("timeout", 1800));
const out = option("out", `forge-wasm-${seats}seat.jsonl`);
const policy = option("policy", "pass");
const games = Number(option("games", 1));
const seedOption = option("seed", null);
const engineSource = option("engine", "npm");
const deckNames = option(
  "decks",
  "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander",
).split(",");

/**
 * The npm package, or a checkout's `packages/forge-wasm` (or any directory
 * holding the same files) when a build under test has not been released.
 */
async function loadPackage(source) {
  if (source === "npm") return import("@manabrew/forge-wasm");
  const dir = resolve(source);
  if (!existsSync(join(dir, "forgeharness.js.wasm"))) {
    throw new Error(`${dir} has no forgeharness.js.wasm; run yarn build:forge-wasm first`);
  }
  return import(pathToFileURL(join(dir, "node.js")).href);
}

const { createForgeEngine, BUILD_COMMIT, VERSION } = await loadPackage(engineSource);

/**
 * A preset as a `ForgeDeck`. The commander has to move out of the 99 and into
 * its own zone: the worker reads each seat's commanders from `deck.commanders`
 * and only falls back to the `commanderName` argument for the human seat, so an
 * opponent whose commander stayed in `cards` plays a 100-card pile with an empty
 * command zone.
 */
function loadDeck(basename) {
  const path = basename.endsWith(".json") ? resolve(basename) : join(PRESETS, `${basename}.json`);
  const raw = JSON.parse(readFileSync(path, "utf8"));
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

/**
 * A seat that plays. One land a turn, then the first spell the engine offers
 * whose payment auto-tap can cover; every creature attacks the first legal
 * target. Auto-pay is tried once per card per turn: a second `payManaCost` for
 * the same card means the tap could not cover it, so the cast is cancelled and
 * the card is left alone until the next turn. The pass policy's answers cover
 * every other prompt.
 */
const greedy = {
  landPlayedOn: -1,
  tried: new Set(),
  paying: null,
  reset(atTurn) {
    if (atTurn !== this.turn) {
      this.turn = atTurn;
      this.tried.clear();
      this.paying = null;
    }
  },
  chooseAction(p, atTurn) {
    this.reset(atTurn);
    const casts = (p.input.actions || []).filter(
      (a) => a.type === "cast" && !this.tried.has(a.cardId),
    );
    const land = casts.find((a) => /^Play /.test(a.label || a.modeLabel || ""));
    const pick = this.landPlayedOn !== atTurn && land ? land : casts.find((a) => a !== land);
    if (!pick) return { type: "pass" };
    this.tried.add(pick.cardId);
    if (pick === land) this.landPlayedOn = atTurn;
    this.paying = null;
    return { type: "act", actionId: pick.id };
  },
  payManaCost(p) {
    if (p.input.canConfirmFromPool) return { type: "pay", auto: false };
    if (this.paying === p.input.cardId) {
      this.paying = null;
      return { type: "cancel" };
    }
    this.paying = p.input.cardId;
    return { type: "pay", auto: true };
  },
  chooseAttackers(p) {
    const assignments = (p.input.attackers || []).flatMap((a) =>
      a.validTargetIds?.length ? [{ attackerId: a.attackerId, targetId: a.validTargetIds[0] }] : [],
    );
    return { type: "declareAttackers", assignments };
  },
};

/**
 * An optional effect answered with "no" can come straight back: some cards
 * re-ask until the player takes them up. Sixty answers to the same prompt type
 * inside one turn is not a game, so flip to "yes, everything" for that turn,
 * and if that does not move it either, give the game up as a loop.
 */
const LOOP_AFTER = 60;
const loop = { turn: -1, counts: new Map(), flipped: false, dumped: false };
function loopGuard(type, prompt, atTurn) {
  if (loop.turn !== atTurn) {
    loop.turn = atTurn;
    loop.counts.clear();
    loop.flipped = false;
  }
  const seen = (loop.counts.get(type) ?? 0) + 1;
  loop.counts.set(type, seen);
  if (seen === LOOP_AFTER && !loop.flipped) {
    loop.flipped = true;
    note({ ev: "loop", type, turn: atTurn, prompt: JSON.stringify(prompt).slice(0, 600) });
  }
  return seen >= 2 * LOOP_AFTER ? "concede" : loop.flipped ? "flip" : null;
}

const FLIPPED = {
  chooseBoolean: () => ({ type: "decision", value: true }),
  chooseCards: (p) => ({
    type: "chooseCardsDecision",
    chosenCardIds: (p.input.cards || []).map((c) => c.id).slice(0, p.input.max ?? undefined),
  }),
};

function answer(type, prompt, atTurn) {
  const guard = loopGuard(type, prompt, atTurn);
  if (guard === "concede") return null;
  if (guard === "flip" && FLIPPED[type]) return FLIPPED[type](prompt);
  if (policy === "greedy" && typeof greedy[type] === "function")
    return greedy[type](prompt, atTurn);
  const reply = REPLIES[type];
  return reply ? reply(prompt) : null;
}

const decks = Array.from({ length: seats }, (_, i) => loadDeck(deckNames[i % deckNames.length]));
const startedAt = Date.now();
const rows = [];
// `up` is process uptime, which is the clock `--trace-gc` prints against, so a
// stall and the collector's lines can be lined up without a second run.
const note = (row) => {
  const line = JSON.stringify({
    t: Date.now() - startedAt,
    up: Math.round(process.uptime() * 1000),
    game,
    ...row,
  });
  rows.push(row);
  appendFileSync(out, `${line}\n`);
};

const memory = () => {
  const m = process.memoryUsage();
  return { rss: m.rss, heap: m.heapUsed, external: m.external, arrayBuffers: m.arrayBuffers };
};

let game = 0;
writeFileSync(out, "");
note({
  ev: "start",
  version: VERSION,
  commit: BUILD_COMMIT,
  seats,
  policy,
  games,
  engine: engineSource,
  decks: deckNames.slice(0, seats),
});

let answeredAt = null;
let prompts = 0;
let turn = 0;
let gameStartedAt = Date.now();
let finishGame = null;
const logs = [];
const STALL_MS = Number(option("stall", 5000));
let lastPrompt = null;
let logLines = 0;

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

function exit(why) {
  console.log(`\n${why}: ${games} games over ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
  if (why !== "game:over") {
    console.log(
      `forge log tail:\n  ${logs
        .slice(-25)
        .map((l) => l.text)
        .join("\n  ")}`,
    );
  }
  summarise();
  process.exit(why === "game:over" ? 0 : 1);
}

setTimeout(() => {
  note({ ev: "end", why: "timeout", prompts, turn, tail: logs.slice(-30).map((l) => l.text) });
  exit("timeout");
}, timeoutS * 1000).unref();

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
    lastPrompt = {
      type,
      actions: prompt.input?.actions?.length ?? null,
      casts: prompt.input?.actions?.filter((a) => a.type === "cast").length ?? null,
    };
    const output = answer(type, prompt, turn);
    if (output?.type === "act" || output?.type === "cancel" || output?.type === "pay") {
      note({ ev: "play", type, output: output.type, card: prompt.input.cardId ?? null, turn });
    }
    if (!output) {
      note({ ev: "unhandled", type, prompt: JSON.stringify(prompt).slice(0, 600) });
      engine.directive({ type: "concede" });
      return;
    }
    answeredAt = Date.now();
    engine.respond(prompt.promptId, { type, output });
  },
  onError: (error) => note({ ev: "error", error: JSON.stringify(error).slice(0, 300) }),
  onEvent: (event, payload) => {
    if (event === "forge:decision") {
      note({ ev: "decision", ...payload, turn, offered: lastPrompt?.actions ?? null });
      if (payload.ms > STALL_MS) {
        console.log(`  stall ${payload.ms}ms ${payload.type} turns=${payload.turns} @turn ${turn}`);
        const since = Date.now() - payload.ms - 50;
        note({
          ev: "stall",
          ...payload,
          turn,
          prompt: lastPrompt,
          log: logs.filter((l) => l.at >= since).map((l) => `${l.at - since}ms ${l.text}`),
        });
      }
      return;
    }
    if (event === "forge:log") {
      logLines += 1;
      logs.push({ at: Date.now(), text: payload.text.slice(0, 300) });
      if (logs.length > 2000) logs.splice(0, 1000);
    }
    if (event === "game:forced_end") finishGame?.("game:forced_end");
    if (event === "game:over") finishGame?.("game:over");
  },
});

note({ ev: "booted", memory: memory() });

for (game = 1; game <= games; game += 1) {
  const seed = seedOption === null ? null : Number(seedOption) + game - 1;
  prompts = 0;
  turn = 0;
  answeredAt = null;
  greedy.landPlayedOn = -1;
  greedy.turn = undefined;
  gameStartedAt = Date.now();
  const ended = new Promise((resolve) => {
    finishGame = resolve;
  });
  await engine.startGame({
    deck: decks[0],
    opponentDecks: decks.slice(1),
    commanderName: decks[0].commanders[0].name,
    ...(seed === null ? {} : { seed }),
  });
  note({ ev: "started", seed });
  const why = await ended;
  finishGame = null;
  note({
    ev: "end",
    why,
    prompts,
    turn,
    duration_ms: Date.now() - gameStartedAt,
    logLines,
    memory: memory(),
    tail: why === "game:over" ? [] : logs.slice(-30).map((l) => l.text),
  });
  console.log(
    `game ${game}/${games} ${why}: ${prompts} prompts over ${((Date.now() - gameStartedAt) / 1000).toFixed(0)}s, turn ${turn}`,
  );
  if (why !== "game:over") exit(why);
  logs.length = 0;
}

exit("game:over");
