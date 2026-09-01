// Autopass, both halves of it, on whichever engine is selected.
//
//   A. Dead windows. The client passes for you when the only thing you could
//      do is tap a land (useAutopass -> AutopassFill). Pure client logic, but
//      it depends on the engine describing its actions the same way.
//   B. The held pass. "Pass until end of turn" sends one answer carrying an
//      `until` target, and the engine is expected to stop asking until it
//      arrives (PriorityFastForward, the same hold hosted Forge uses). If it
//      ignores the target, the player is asked again at every step and
//      autopass is dead even though every individual pass works.
//
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-autopass.mjs
//
// Env: BASE, DECK, AI_DECK, ENGINE=forge|rust, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const AI_DECK = process.env.AI_DECK || "Esper Pixie";
const ENGINE = process.env.ENGINE === "rust" ? "rust" : "forge";

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
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

await onboard(page, uniqueName("Auto"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
if (!(await page.evaluate(() => Boolean(window.__gameStore))))
  await fail("window.__gameStore is dev-only, so this test needs a dev server");
await page.getByRole("button", { name: "Standard", exact: true }).click();
await page.waitForTimeout(600);
for (const deck of [DECK, AI_DECK]) {
  const card = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
  if (!(await card.count())) await fail(`deck "${deck}" is not on the Standard tab`);
  await card.click();
  await page.waitForTimeout(500);
}
await page.getByRole("button", { name: /^Fight!$/ }).click();
await page.waitForTimeout(15000);

// Record every window the engine opens, and what the client did with it.
await page.evaluate(() => {
  const w = window;
  w.__windows = [];
  let last = null;
  w.__autoUnsub = w.__gameStore.subscribe((s) => {
    const p = s.currentPrompt;
    if (!p || p.promptId === last) return;
    last = p.promptId;
    const view = s.gameView;
    w.__windows.push({
      id: p.promptId,
      type: p.input?.type,
      step: view?.step ?? null,
      turn: view?.turn ?? null,
      dead:
        p.input?.type === "chooseAction" &&
        (p.input.actions || []).every((a) => a.type === "activateAbility" && a.isManaAbility),
    });
  });
});

const keep = page.getByRole("button", { name: /^Keep$/i }).first();
if (await keep.count()) {
  await keep.click();
  await page.waitForTimeout(1500);
}

// The engines open with different acknowledgements (a die roll, a reveal), and
// an unanswered one stalls the game before autopass has anything to do.
const acknowledge = async () => {
  for (let round = 0; round < 8; round += 1) {
    const done = await page.evaluate(async () => {
      const store = window.__gameStore;
      const prompt = store.getState().currentPrompt;
      const type = prompt?.input?.type;
      if (!type || type === "chooseAction") return true;
      const answers = {
        diceRolled: { type: "diceRolledAcknowledged" },
        revealCards: { type: "revealCardsAcknowledged" },
        mulligan: { type: "mulliganDecision", keep: true },
      };
      const answer = answers[type];
      if (!answer) return true;
      await store.getState().respond(answer);
      return false;
    });
    if (done) return;
    await page.waitForTimeout(1500);
  }
};
await acknowledge();

// A. Dead windows: leave the page alone and see whether the game moves on its
// own. Every window we are shown that we did not answer would stall it.
await page.waitForTimeout(12000);
await acknowledge();
const afterIdle = await page.evaluate(() => ({
  windows: window.__windows.length,
  dead: window.__windows.filter((x) => x.dead).length,
  step: window.__gameStore.getState().gameView?.step ?? null,
  turn: window.__gameStore.getState().gameView?.turn ?? null,
  waiting: window.__gameStore.getState().isWaitingForResponse,
}));
console.log(`· idle: ${JSON.stringify(afterIdle)}`);

// B. The held pass. Answer the live window with a target the engine has to
// respect, then count how many times it asks again before reaching it.
const held = await page.evaluate(async () => {
  const store = window.__gameStore;
  const state = store.getState();
  const prompt = state.currentPrompt;
  if (!prompt || prompt.input?.type !== "chooseAction")
    return { skipped: prompt?.input?.type ?? null };
  const me = state.myPlayerSlot ?? "player-0";
  const mark = window.__windows.length;
  await store.getState().respond({
    type: "pass",
    until: { playerId: me, phase: "endOfTurn" },
    exhaustStack: false,
  });
  return { mark, me, from: state.gameView?.step ?? null, turn: state.gameView?.turn ?? null };
});
if (held.skipped !== undefined) {
  await fail(`no priority window to hold from; the live prompt was ${held.skipped}`);
}
console.log(`· held a pass until endOfTurn from ${held.from} (turn ${held.turn})`);

await page.waitForTimeout(20000);
const asked = await page.evaluate(
  (mark) =>
    window.__windows
      .slice(mark)
      .filter((w) => w.type === "chooseAction")
      .map((w) => `${w.turn}/${w.step}`),
  held.mark,
);
const state = await page.evaluate(() => ({
  step: window.__gameStore.getState().gameView?.step ?? null,
  turn: window.__gameStore.getState().gameView?.turn ?? null,
}));
await page.evaluate(() => window.__autoUnsub && window.__autoUnsub());

// Anything the engine asks before the target is the hold being ignored. Windows
// at or after it are the hold expiring, which is correct.
const beforeTarget = asked.filter((w) => {
  const [turn, step] = w.split("/");
  return Number(turn) === held.turn && step !== "endOfTurn" && step !== "cleanup";
});
if (beforeTarget.length) {
  await fail(
    `the ${ENGINE} engine ignored the held pass: asked again at ${beforeTarget.join(", ")} before endOfTurn`,
  );
}
if (state.turn === held.turn && state.step === held.from) {
  await fail(`the game did not move after the held pass: still ${state.turn}/${state.step}`);
}
console.log(
  `PASS: autopass works on the ${ENGINE} engine — ${afterIdle.dead} dead window(s) passed for the player, held pass honoured (asked ${asked.length}x after it, now at turn ${state.turn} ${state.step})`,
);
await browser.close();
