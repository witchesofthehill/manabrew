// Driving a solo game on the offline page, shared by the forge-wasm-* scripts.
//
// Starting a game is three clicks now: Fight! on the deck picker, Fight on the
// table picker, and for Commander a choice between 1v1 and a 4-player pod.
// Prompts are drawn on the canvas, so a script answers them through the game
// store, which a dev server exposes as window.__gameStore; the answers cover
// every prompt type with the least committal choice, so a game moves without
// the driver playing it.

/** Pick the format tab and the decks on the offline page, in order. */
export async function pickDecks(page, format, decks, fail) {
  await page.getByRole("button", { name: format, exact: true }).click();
  await page.waitForTimeout(700);
  for (const deck of decks) {
    const card = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
    if (!(await card.count())) await fail(`deck "${deck}" is not on the ${format} tab`);
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
}

/** Fight! and through the dialogs; `pod` asks for a 4-player Commander table. */
export async function fight(page, { pod = false } = {}) {
  await page.getByRole("button", { name: /^Fight!$/ }).click();
  await page.waitForTimeout(800);
  const table = page.getByRole("button", { name: /^Fight$/ }).first();
  if (await table.count()) await table.click();
  await page.waitForTimeout(800);
  const players = page.getByRole("button", { name: pod ? /4-player pod/ : /1v1/ }).first();
  if (await players.count()) await players.click();
}

/** Deck picks plus Fight!, the way every solo script starts. */
export async function startSoloGame(page, { format, decks, pod = false, fail }) {
  await pickDecks(page, format, decks, fail);
  await fight(page, { pod });
}

/**
 * Answers the live prompt through the store. Returns the prompt type answered,
 * null when there was nothing to answer (or no store), and "gameOver" once
 * the game is over. Runs in the page, so it must stay self-contained.
 */
export function answerPrompt(page, overrides = {}) {
  return page
    .evaluate((overrides) => {
      const state = window.__gameStore?.getState?.();
      if (!state) return null;
      if (state.gameView?.gameOver || state.currentPrompt?.input?.type === "gameOver")
        return "gameOver";
      if (!state.currentPrompt || state.isWaitingForResponse) return null;
      const input = state.currentPrompt.input;
      const ids = (list) => (list || []).map((c) => c && (c.id || c.cardId)).filter(Boolean);
      const land = (input.actions || []).find(
        (a) => a.type === "cast" && /^Play /.test(a.label || ""),
      );
      const answers = {
        chooseAction:
          overrides.playLands && land
            ? { type: "act", actionId: land.id }
            : { type: "pass", exhaustStack: false },
        mulligan: { type: "mulliganDecision", keep: true },
        mulliganPutBack: {
          type: "mulliganPutBackDecision",
          cardIds: (input.handCardIds || ids(input.cards)).slice(0, input.count || 0),
        },
        revealCards: { type: "revealCardsAcknowledged" },
        diceRolled: { type: "diceRolledAcknowledged" },
        chooseBoolean: { type: "decision", value: false },
        chooseAttackers: { type: "declareAttackers", assignments: [] },
        chooseBlockers: { type: "declareBlockers", assignments: [] },
        payManaCost: overrides.playLands ? { type: "pay", auto: true } : { type: "cancel" },
        chooseCards: {
          type: "chooseCardsDecision",
          chosenCardIds: (input.cardIds || ids(input.cards)).slice(0, input.min || 0),
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
          zoneCardIds: (input.zones || []).map((_, index) => (index === 0 ? ids(input.cards) : [])),
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
      if (!answer) return null;
      void state.respond(answer);
      return input.type;
    }, overrides)
    .catch(() => null);
}

/** Waits for the first prompt after Fight!; the engine boots on a fresh origin. */
export async function waitForFirstPrompt(page, timeout = 120000) {
  await page.waitForFunction(() => Boolean(window.__gameStore?.getState?.()?.currentPrompt), {
    timeout,
  });
}

/**
 * Answers prompts until `done()` says so or the budget runs out; `done` gets
 * the type just answered (or null). Returns how many prompts were answered.
 */
export async function drive(page, { done, budgetMs = 60000, overrides = {} } = {}) {
  const deadline = Date.now() + budgetMs;
  let answered = 0;
  while (Date.now() < deadline) {
    const type = await answerPrompt(page, overrides);
    if (type === "gameOver") break;
    if (type) answered += 1;
    if (done && (await done(type, answered))) break;
    await page.waitForTimeout(type ? 40 : 200);
  }
  return answered;
}
