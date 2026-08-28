// A game has to end. Lethal damage, a concede, either way: the client must be
// told, and the engine must stop being the only thing that knows.
//
// The browser engine blocks its worker inside one call for the whole game, so
// when that call returns there is nobody left to answer a prompt or read a
// concede out of the shared buffer. If the final board never reaches the
// client, the player is left watching "waiting for Forge AI" forever with a
// concede button that does nothing.
//
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-gameover.mjs
//
// Env: BASE, DECK, AI_DECK, FORMAT, ENGINE=forge|rust, BUDGET_MS, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const FORMAT = process.env.FORMAT || "Pioneer";
const DECK = process.env.DECK || "Izzet Creativity";
const AI_DECK = process.env.AI_DECK || "Red Deck Wins";
const ENGINE = process.env.ENGINE === "rust" ? "rust" : "forge";
const BUDGET_MS = Number(process.env.BUDGET_MS || 300000);

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
  const log = await page.evaluate(() => (window.__forgeLog || []).slice(-6)).catch(() => []);
  for (const line of log) console.log("   engine:", String(line).slice(0, 140));
  console.log(`FAIL: ${msg}${pageError ? ` (pageerror: ${pageError})` : ""}`);
  await browser.close();
  process.exit(1);
}

await page.addInitScript((on) => {
  try {
    const raw = localStorage.getItem("manabrew-preferences");
    const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    doc.state = { ...(doc.state || {}), forgeWasmEnabled: on };
    localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
  } catch {
    // First load on a fresh origin; the store writes its own defaults.
  }
}, ENGINE === "forge");

await onboard(page, uniqueName("Over"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
// window.__gameStore is dev-only. Against a deployed build the game has to be
// played through the board, which is slower but is the only way to check the
// thing where it actually broke.
const hasStore = await page.evaluate(() => Boolean(window.__gameStore));
await page.getByRole("button", { name: FORMAT, exact: true }).click();
await page.waitForTimeout(700);
for (const deck of [DECK, AI_DECK]) {
  const card = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
  if (!(await card.count())) await fail(`deck "${deck}" is not on the ${FORMAT} tab`);
  await card.click();
  await page.waitForTimeout(500);
}
await page.getByRole("button", { name: /^Fight!$/ }).click();
await page.waitForTimeout(15000);

// Take no actions beyond what a prompt demands: the point is to lose fast.
const over = hasStore ? await storeDrivenEnding() : await boardDrivenEnding();

async function boardDrivenEnding() {
  const deadline = Date.now() + BUDGET_MS;
  while (Date.now() < deadline) {
    const ended = await page.evaluate(() => {
      const text = document.body.innerText;
      return /you win|you lose|game over|victory|defeat/i.test(text);
    });
    if (ended) return true;
    // Priority first, and never "PASSING": that button holds priority.
    const passed = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((candidate) => {
        const label = (candidate.textContent || "").trim().toUpperCase();
        return label.startsWith("PASS") && !label.startsWith("PASSING") && !candidate.disabled;
      });
      if (!button) return false;
      button.click();
      return true;
    });
    if (!passed) {
      let acted = false;
      for (const name of [/^Keep$/i, /^Continue$/i, /^OK$/i, /^Done$/i, /^No Blocks$/i]) {
        const button = page.getByRole("button", { name }).first();
        if (!(await button.count().catch(() => 0))) continue;
        await button.click({ timeout: 5000 }).catch(() => {});
        acted = true;
        break;
      }
      if (!acted) await page.waitForTimeout(800);
    }
    await page.waitForTimeout(400);
  }
  return false;
}

async function storeDrivenEnding() {
  return page
    .waitForFunction(
      // Synchronous on purpose: an async predicate returns a Promise, which
      // Playwright reads as truthy, and the wait ends before the game does.
      () => {
        const store = window.__gameStore;
        const state = store.getState();
        if (state.gameView?.gameOver || state.currentPrompt?.input?.type === "gameOver")
          return true;
        if (!state.currentPrompt || state.isWaitingForResponse) return false;
        const input = state.currentPrompt.input;
        const ids = (list) => (list || []).map((c) => c && (c.id || c.cardId)).filter(Boolean);
        const answers = {
          chooseAction: { type: "pass", exhaustStack: false },
          mulligan: { type: "mulliganDecision", keep: true },
          mulliganPutBack: {
            type: "mulliganPutBackDecision",
            cardIds: ids(input.cards).slice(0, input.count || 0),
          },
          revealCards: { type: "revealCardsAcknowledged" },
          diceRolled: { type: "diceRolledAcknowledged" },
          chooseBoolean: { type: "decision", value: false },
          chooseAttackers: { type: "declareAttackers", assignments: [] },
          chooseBlockers: { type: "declareBlockers", assignments: [] },
          payManaCost: { type: "cancel" },
          chooseCards: {
            type: "chooseCardsDecision",
            chosenCardIds: ids(input.cards).slice(0, input.min || 0),
          },
          chooseFromSelection: {
            type: "selectionDecision",
            chosenIndices: Array.from({ length: Math.max(0, input.minTotal || 0) }, (_, i) => i),
          },
          chooseNumber: { type: "numberDecision", chosenNumber: input.min ?? 0 },
          chooseColor: {
            type: "colorDecision",
            chosenColors: (input.validColors || [])[0]
              ? { [(input.validColors || [])[0]]: input.amount || 1 }
              : {},
          },
          scry: {
            type: "scryDecision",
            zoneCardIds: (input.zones || []).map((_, index) =>
              index === 0 ? ids(input.cards) : [],
            ),
          },
          reorder: {
            type: "reorderDecision",
            orderedIds: (input.items || []).map((i) => i && (i.id || i.cardId)).filter(Boolean),
          },
          chooseBoardTargets: { type: "cancel" },
          chooseDamageAssignmentOrder: {
            type: "damageAssignmentOrderDecision",
            orderedBlockerIds: ids(input.blockers),
          },
        };
        const answer = answers[input.type];
        if (answer) void state.respond(answer);
        return false;
      },
      { timeout: BUDGET_MS, polling: 400 },
    )
    .then(() => true)
    .catch(() => false);
}

const state = await page.evaluate(() => {
  const s = window.__gameStore?.getState?.();
  if (!s) {
    const text = document.body.innerText.replace(/\s+/g, " ");
    return { deployed: true, says: text.slice(0, 160) };
  }
  return {
    gameOver: s.gameView?.gameOver ?? null,
    winner: s.gameView?.winnerId ?? null,
    prompt: s.currentPrompt?.input?.type ?? null,
    waiting: s.isWaitingForResponse,
    turn: s.gameView?.turn ?? null,
    lives: (s.gameView?.players ?? []).map((p) => p.life),
    active: s.isGameActive,
  };
});
if (!over) {
  await fail(`the game never ended: ${JSON.stringify(state)}`);
}
console.log(`PASS: the ${ENGINE} engine ended its game — ${JSON.stringify(state)}`);
await browser.close();
