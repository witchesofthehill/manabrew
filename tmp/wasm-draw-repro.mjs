import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createForgeEngine } from "../packages/forge-wasm/node.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS = join(root, "public", "preset_decks");
const arg = (name, fb) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? fb : process.argv[i + 1]; };
const seats = Number(arg("seats", 2));
const timeoutS = Number(arg("timeout", 900));
const deckNames = arg("decks", "kaalia_regression_commander,starter_deck_animar,real_teval_commander,neheb_minotaur_commander").split(",");
const verbose = process.argv.includes("--verbose");

function loadDeck(basename) {
  const raw = JSON.parse(readFileSync(join(PRESETS, `${basename}.json`), "utf8"));
  const card = (c) => ({ name: c.name, setCode: c.set, cardNumber: c.cardNumber, count: c.count ?? 1 });
  const isCommander = (c) => c.name === raw.commander;
  const commander = raw.cards.find(isCommander);
  if (!commander) throw new Error(`${basename}: commander "${raw.commander}" is not in the deck`);
  return {
    name: raw.label, format: raw.format,
    commanders: [{ ...card(commander), count: 1 }],
    cards: raw.cards.flatMap((c) => isCommander(c) ? (c.count > 1 ? [{ ...card(c), count: c.count - 1 }] : []) : [card(c)]),
  };
}

const REPLIES = {
  mulligan: () => ({ type: "mulliganDecision", keep: true }),
  mulliganPutBack: (p) => ({ type: "mulliganPutBackDecision", cardIds: (p.input.handCardIds || []).slice(0, p.input.count || 0) }),
  diceRolled: () => ({ type: "diceRolledAcknowledged" }),
  revealCards: () => ({ type: "revealCardsAcknowledged" }),
  chooseAction: () => ({ type: "pass" }),
  chooseBoolean: () => ({ type: "decision", value: false }),
  chooseCards: (p) => ({ type: "chooseCardsDecision", chosenCardIds: (p.input.cards || []).map((c) => c.id).slice(0, p.input.min || 0) }),
  chooseAttackers: () => ({ type: "declareAttackers", assignments: [] }),
  chooseBlockers: () => ({ type: "declareBlockers", assignments: [] }),
  chooseBoardTargets: (p) => ({ type: "boardTargets", chosen: (p.input.candidates || []).slice(0, Math.max(0, p.input.minTargets || 0)) }),
  chooseColor: (p) => ({ type: "colorDecision", chosenColors: { [(p.input.validColors || ["W"])[0]]: p.input.amount ?? 1 } }),
  chooseNumber: (p) => ({ type: "numberDecision", chosenNumber: p.input.min ?? 0 }),
  chooseFromSelection: (p) => { const options = p.input.options || []; const chosen = []; let total = 0; for (let i = 0; i < options.length && total < (p.input.minTotal || 0); i += 1) { chosen.push(i); total += options[i].weight ?? 1; } return { type: "selectionDecision", chosenIndices: chosen }; },
  chooseCombatDamageAssignment: (p) => { const target = (p.input.blockerIds || [])[0] ?? p.input.defenderId; return { type: "combatDamageAssignmentDecision", assignments: target ? [{ assigneeId: target, damage: p.input.totalDamage ?? 0 }] : [] }; },
  chooseDamageAssignmentOrder: (p) => ({ type: "damageAssignmentOrderDecision", orderedBlockerIds: p.input.blockerIds || [] }),
  scry: (p) => ({ type: "scryDecision", zoneCardIds: (p.input.zones || []).map((_, i) => (i === 0 ? (p.input.cards || []).map((c) => c.id) : [])) }),
  reorder: (p) => ({ type: "reorderDecision", orderedIds: (p.input.items || []).map((i) => i.id) }),
  payManaCost: () => ({ type: "cancel" }),
};

const decks = Array.from({ length: seats }, (_, i) => loadDeck(deckNames[i % deckNames.length]));
const t0 = Date.now();
const logs = [];
let last = null;
let prompts = 0;
const zoneCounts = (gv) => (gv?.zones || []).filter((z) => z.kind === "library" || z.zone === "library" || z.type === "library").map((z) => `${z.ownerId ?? z.playerId}:${(z.cards || z.cardIds || []).length}`).join(" ");

function finish(why) {
  const gv = last?.gameView;
  console.log(`\n${why} after ${((Date.now() - t0) / 1000).toFixed(0)}s, ${prompts} prompts`);
  if (gv) {
    console.log(`turn=${gv.turn} step=${gv.step} active=${gv.activePlayerId} priority=${gv.priorityPlayerId} gameOver=${gv.gameOver} winnerId=${gv.winnerId}`);
    for (const p of gv.players) console.log(`  ${p.id} ${p.name} status=${p.status} life=${p.life}`);
    console.log(`  zones: ${(gv.zones || []).map((z) => `${JSON.stringify(Object.fromEntries(Object.entries(z).filter(([k]) => !Array.isArray(z[k]))))}=${(z.cards || z.cardIds || []).length}`).slice(0, 12).join("\n         ")}`);
  } else console.log("no state received");
  console.log(`forge log (${logs.length} lines), tail:\n  ${logs.slice(-40).join("\n  ")}`);
  process.exit(0);
}
setTimeout(() => finish("timeout"), timeoutS * 1000).unref();

const engine = await createForgeEngine({
  onState: (state) => { last = state; if (verbose) console.log(`state turn=${state.gameView?.turn} over=${state.gameView?.gameOver}`); },
  onPrompt: (prompt) => {
    prompts += 1;
    const type = prompt.input?.type;
    if (verbose) console.log(`prompt ${type}`);
    if (type === "gameOver") return;
    const reply = REPLIES[type];
    if (!reply) { console.log(`unhandled prompt ${type}: ${JSON.stringify(prompt).slice(0, 300)}`); engine.directive({ type: "concede" }); return; }
    engine.respond(prompt.promptId, { type, output: reply(prompt) });
  },
  onError: (error) => console.log(`error: ${JSON.stringify(error).slice(0, 300)}`),
  onEvent: (event, payload) => {
    if (event === "forge:log") { logs.push(payload.text); if (verbose || /Exception|\[wasm\]|Lazy|error|Error|at forge/.test(payload.text)) console.log(`  log: ${payload.text.slice(0, 300)}`); }
    if (event === "game:forced_end") { console.log(`forced_end ${JSON.stringify(payload)}`); finish("game:forced_end"); }
    if (event === "game:over") finish("game:over");
  },
});
console.log(`booted in ${Date.now() - t0}ms`);
await engine.startGame({ deck: decks[0], opponentDecks: decks.slice(1), commanderName: decks[0].commanders[0].name });
console.log(`started`);
