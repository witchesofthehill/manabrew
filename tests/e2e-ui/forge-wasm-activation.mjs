// Measures browser engine turnaround split by the kind of action submitted,
// and in particular by ability activation — the one hosted case that hurts
// (about 385ms node-side, a fixed charge rather than a board-size effect).
//
// The generic latency script clicks UI buttons, so it almost never activates
// anything. This one drives the store's respond() seam directly and prefers
// activations whenever the engine offers them, so the expensive case actually
// gets sampled. Responses still go through the app's real submit path.
//
//   VITE_FORGE_WASM=1 npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-activation.mjs
//
// Env: BASE, DECK, AI_DECK, LABEL, BUDGET_MS, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const AI_DECK = process.env.AI_DECK || "Esper Pixie";
const LABEL = process.env.LABEL || "forge-wasm";
const BUDGET_MS = Number(process.env.BUDGET_MS || 240000);

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
  console.log(`FAIL: ${msg}${pageError ? ` (pageerror: ${pageError})` : ""}`);
  await browser.close();
  process.exit(1);
}

await onboard(page, uniqueName("Act"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Standard", exact: true }).click();
await page.waitForTimeout(600);
for (const deck of [DECK, AI_DECK]) {
  const card = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
  if (!(await card.count())) await fail(`deck "${deck}" is not on the Standard tab`);
  await card.click();
  await page.waitForTimeout(500);
}
await page.waitForFunction(
  () => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      /^Fight!$/.test(x.textContent || ""),
    );
    return b && !b.disabled;
  },
  { timeout: 15000 },
);
await page.getByRole("button", { name: /^Fight!$/ }).click();
await page.waitForTimeout(18000);

// Answer prompts from inside the page, preferring activations, and record the
// gap from each submit to the next prompt keyed by what was submitted.
await page.evaluate(() => {
  const w = window;
  w.__actSamples = [];
  w.__actBad = new Set();
  w.__actFails = new Map();
  w.__actPaying = null;
  w.__actSent = null;
  w.__actAt = null;

  const store = w.__gameStore;
  if (!store) throw new Error("window.__gameStore is absent — is this the vite dev server?");

  const ids = (list) => (list || []).map((c) => c && (c.id || c.cardId)).filter(Boolean);

  const answer = (input) => {
    switch (input.type) {
      case "chooseAction": {
        const acts = input.actions || [];
        // Prefer a real activation, then a cast, then pass. Anything whose
        // payment we abandoned is skipped, otherwise the engine re-offers it
        // and the run degenerates into a cast/cancel loop that samples nothing.
        const act = acts.find(
          (a) => a.type === "activateAbility" && !a.isManaAbility && !w.__actBad.has(a.id),
        );
        if (act) {
          w.__actPaying = act.id;
          return ["activateAbility", { type: "act", actionId: act.id }];
        }
        const cast = acts.find((a) => a.type === "cast" && !w.__actBad.has(a.id));
        if (cast) {
          w.__actPaying = cast.id;
          return ["cast", { type: "act", actionId: cast.id }];
        }
        return ["pass", { type: "pass" }];
      }
      case "payManaCost": {
        if (input.canConfirmFromPool) return ["payMana", { type: "pay" }];
        const src = (input.actions || []).find((a) => a.isManaAbility);
        if (src) return ["tapForMana", { type: "act", actionId: src.id }];
        if (w.__actPaying) {
          const n = (w.__actFails.get(w.__actPaying) || 0) + 1;
          w.__actFails.set(w.__actPaying, n);
          if (n >= 2) w.__actBad.add(w.__actPaying);
        }
        return ["payCancel", { type: "cancel" }];
      }
      case "chooseBoardTargets": {
        const me = store.getState().myPlayerSlot;
        const c = input.candidates || [];
        const t = c.find((x) => x.kind === "player" && x.id !== me) || c[0];
        return t
          ? ["target", { type: "boardTargets", chosen: [{ kind: t.kind, id: t.id }] }]
          : ["targetCancel", { type: "cancel" }];
      }
      case "mulligan":
        return ["mulligan", { type: "mulligan", keep: true }];
      case "mulliganPutBack":
        return [
          "putBack",
          { type: "mulliganPutBack", cardIds: ids(input.cards).slice(0, input.count || 0) },
        ];
      case "chooseCards":
        return [
          "chooseCards",
          { type: "chooseCards", chosenCardIds: ids(input.cards).slice(0, input.min || 0) },
        ];
      case "chooseAttackers":
        return ["attack", { type: "declareAttackers", assignments: [] }];
      case "chooseBlockers":
        return ["block", { type: "declareBlockers", assignments: [] }];
      case "chooseBoolean":
        return ["boolean", { type: "chooseBoolean", value: false }];
      case "diceRolled":
        return ["dice", { type: "diceRolled" }];
      default:
        return null;
    }
  };

  // Subscribe rather than poll: a polling driver adds up to its interval to
  // every sample, which is the same order as the thing being measured.
  let lastPromptId = null;
  const onChange = (st) => {
    const p = st.currentPrompt;
    if (!p || st.isWaitingForResponse) return;
    if (p.promptId === lastPromptId) return;

    if (w.__actSent && w.__actAt != null) {
      w.__actSamples.push({
        sent: w.__actSent,
        ms: performance.now() - w.__actAt,
        next: p.input?.type,
      });
      w.__actSent = null;
      w.__actAt = null;
    }

    const picked = answer(p.input || {});
    if (!picked) return;
    lastPromptId = p.promptId;
    w.__actSent = picked[0];
    w.__actAt = performance.now();
    Promise.resolve(st.respond(picked[1])).catch(() => {
      w.__actSent = null;
      w.__actAt = null;
    });
  };
  w.__actUnsub = store.subscribe(onChange);
  onChange(store.getState());
});

const deadline = Date.now() + BUDGET_MS;
while (Date.now() < deadline) {
  const n = await page.evaluate(() => (window.__actSamples || []).length).catch(() => 0);
  const acts = await page
    .evaluate(() => (window.__actSamples || []).filter((s) => s.sent === "activateAbility").length)
    .catch(() => 0);
  if (acts >= 30 || n >= 900) break;
  await page.waitForTimeout(1000);
}

const samples = await page.evaluate(() => window.__actSamples || []);
const engine = await page.evaluate(() => window.__engineDecisions || []);
await page.evaluate(() => window.__actUnsub && window.__actUnsub());
if (samples.length < 5) await fail(`only ${samples.length} samples; the loop did not turn over`);

const by = {};
for (const s of samples) (by[s.sent] ??= []).push(s.ms);
const stat = (list) => {
  const a = list.slice().sort((x, y) => x - y);
  const p = (q) => a[Math.min(a.length - 1, Math.floor((q / 100) * a.length))];
  return `n=${String(a.length).padStart(3)}  p50 ${p(50).toFixed(0).padStart(4)}  p90 ${p(90).toFixed(0).padStart(4)}  max ${a[a.length - 1].toFixed(0).padStart(4)}`;
};

console.log(`\n${LABEL}: browser turnaround by submitted action (ms), ${samples.length} decisions`);
for (const [kind, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${kind.padEnd(14)} ${stat(list)}`);
}
if (engine.length) {
  const eby = {};
  for (const e of engine) (eby[e.type] ??= []).push(e.ms);
  console.log(
    `\nengine-side think time (ms), ${engine.length} decisions — no client polling in this path`,
  );
  for (const [type, list] of Object.entries(eby).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${type.padEnd(20)} ${stat(list)}`);
  }
}

const act = by.activateAbility;
console.log(
  act
    ? `\nactivateAbility sampled ${act.length}x — hosted costs ~385ms node-side plus a ~47ms hop`
    : `\nNOTE: no ability activations were offered in this run; the decks may not present any`,
);
await browser.close();
