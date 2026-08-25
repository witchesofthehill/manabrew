// A finished offline game reports how the engine performed. The report is the
// only measurement we have of an engine running on a player's machine, so it
// has to survive the path it actually takes: queued in localStorage when the
// game ends, POSTed to the hub on the next flush.
//
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-telemetry.mjs
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

// The hub is not running in a dev checkout, so answer for it and keep what the
// client tried to send.
const posted = [];
await page.route("**/api/stats/engine", async (route) => {
  posted.push(JSON.parse(route.request().postData() ?? "{}"));
  await route.fulfill({ status: 204, body: "" });
});

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

await onboard(page, uniqueName("Tele"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
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

// Play enough decisions that the report is worth sending: a game nobody
// played is deliberately not reported, so a handful of clicks is not enough.
// Answered through the store, which is the same path the UI takes.
await page.evaluate(async () => {
  const store = window.__gameStore;
  const answerFor = (input) => {
    switch (input?.type) {
      case "chooseAction":
        return { type: "pass", exhaustStack: false };
      case "mulligan":
        return { type: "mulliganDecision", keep: true };
      case "revealCards":
        return { type: "revealCardsAcknowledged" };
      case "diceRolled":
        return { type: "diceRolledAcknowledged" };
      case "chooseBoolean":
        return { type: "decision", value: false };
      case "chooseAttackers":
        return { type: "declareAttackers", assignments: [] };
      case "chooseBlockers":
        return { type: "declareBlockers", assignments: [] };
      case "payManaCost":
        return { type: "cancel" };
      default:
        return null;
    }
  };
  for (let step = 0; step < 60; step += 1) {
    const state = store.getState();
    if (!state.isGameActive) break;
    const answer =
      state.currentPrompt && !state.isWaitingForResponse
        ? answerFor(state.currentPrompt.input)
        : null;
    if (answer) await state.respond(answer);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});
await page.waitForTimeout(1500);

// Leave the game the way a player does.
await page.evaluate(() => window.__gameStore?.getState?.().endGame?.());
await page.waitForTimeout(3000);

const queued = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("manabrew-engine-stats-reports") ?? "[]"),
);
if (!posted.length && !queued.length) {
  const diag = await page.evaluate(() => {
    const store = window.__gameStore?.getState?.();
    return {
      active: store?.isGameActive ?? null,
      prompts: (window.__forgeFrames || []).filter((f) => f.startsWith("prompt")).length,
      keys: Object.keys(localStorage).filter((k) => k.includes("engine")),
    };
  });
  console.log("diagnostics:", JSON.stringify(diag));
  await fail("the game ended and reported nothing");
}
const report = posted[0] ?? queued[0]?.stats;
if (report.engine !== (ENGINE === "forge" ? "forge-wasm" : "manabrew")) {
  await fail(`report names the wrong engine: ${report.engine}`);
}
if (!report.reportId || !report.turnaround?.n) {
  await fail(`report is missing its measurements: ${JSON.stringify(report).slice(0, 200)}`);
}
if (ENGINE === "forge" && !report.engineThink?.n) {
  await fail("the Forge engine reports its own think time, but the report carries none");
}
// Nothing about the deck, the cards or the player may ride along.
const text = JSON.stringify(report);
for (const leak of [DECK, AI_DECK, "Island", "Mountain"]) {
  if (text.includes(leak)) await fail(`the report carries "${leak}"`);
}
console.log(
  `PASS: ${ENGINE} reported a game — ${report.turnaround.n} decisions, p50 ${report.turnaround.p50}ms` +
    (report.engineThink ? `, engine p50 ${report.engineThink.p50}ms` : "") +
    `, ${posted.length ? "posted" : "queued"}`,
);
await browser.close();
