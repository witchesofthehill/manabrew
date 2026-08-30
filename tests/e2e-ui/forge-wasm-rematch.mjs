// A player leaves a game and starts another one. The Forge engine blocks its
// worker for the whole game, parked on Atomics.wait waiting for a seat to
// answer, so a game that is abandoned rather than played out can leave the
// worker stuck and every later game refused with "Game already active".
//
//   npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-rematch.mjs
//
// Env: BASE, DECK, AI_DECK, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const AI_DECK = process.env.AI_DECK || "Esper Pixie";

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

await page.addInitScript(() => {
  try {
    const raw = localStorage.getItem("manabrew-preferences");
    const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    doc.state = { ...(doc.state || {}), forgeWasmEnabled: true };
    localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
  } catch {
    // First load on a fresh origin; the store writes its own defaults.
  }
});

await onboard(page, uniqueName("Again"));

async function startGame(attempt) {
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
  const framed = await page
    .waitForFunction(() => (window.__forgeFrames || []).some((f) => f.startsWith("prompt")), {
      timeout: 120000,
    })
    .then(() => true)
    .catch(() => false);
  if (!framed) await fail(`game ${attempt} never produced a prompt`);
  console.log(`· game ${attempt} started`);
}

await startGame(1);

// Walk out of the game the way a player does, without finishing it.
await page.evaluate(() => {
  window.__forgeFrames = [];
});
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
console.log("· left the first game");

await startGame(2);
console.log("PASS: a second game starts after walking out of the first");
await browser.close();
