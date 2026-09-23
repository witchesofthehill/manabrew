// Measures engine turnaround in the browser: the gap between the client
// writing a response and the engine's next prompt landing. That is the
// interval a hosted round trip competes against, so it is the number that
// decides a client-side engine against the node fleet.
//
// Engine-agnostic on purpose — run it once with VITE_FORGE_WASM=1 for the
// Wasm Forge build and once without for the Rust engine, against the same UI
// and the same script, so the two are comparable.
//
//   VITE_FORGE_WASM=1 npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 LABEL=forge-wasm node tests/e2e-ui/forge-wasm-latency.mjs
//
// A four-seat Commander pod is the shape that hurts, and a different one:
//   FORMAT=Commander POD=1 DECK="Ashling, the Limitless" AI_DECK=Kasla LABEL=pod \
//     node tests/e2e-ui/forge-wasm-latency.mjs
//
// Env: BASE, FORMAT, DECK, AI_DECK, POD=1, LABEL, SAMPLES, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";
import { drive, startSoloGame, waitForFirstPrompt } from "./forgeSolo.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const FORMAT = process.env.FORMAT || "Standard";
const POD = process.env.POD === "1";
const DECK = process.env.DECK || (POD ? "Ashling, the Limitless" : "Izzet Lessons");
const AI_DECK = process.env.AI_DECK || (POD ? "Kasla" : "Esper Pixie");
const LABEL = process.env.LABEL || "engine";
const SAMPLES = Number(process.env.SAMPLES || 60);

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
  console.log(`FAIL: ${msg}${pageError ? ` (pageerror: ${pageError})` : ""}`);
  await browser.close();
  process.exit(1);
}

await onboard(page, uniqueName("Lat"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await startSoloGame(page, {
  format: POD ? "Commander" : FORMAT,
  decks: [DECK, AI_DECK],
  pod: POD,
  fail,
});
await waitForFirstPrompt(page).catch(() => fail("the game never produced a prompt"));

// Lands get played so the game has a board to think about; everything else
// is the least committal answer.
const count = () => page.evaluate(() => (window.__promptTimings || []).length);
await drive(page, {
  budgetMs: 600000,
  overrides: { playLands: true },
  done: async () => (await count()) >= SAMPLES,
});

const timings = await page.evaluate(() => window.__promptTimings || []);
if (timings.length < 5) await fail(`only ${timings.length} samples; the loop did not turn over`);

const ms = timings.map((t) => t.ms).sort((a, b) => a - b);
const pct = (p) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))];
const byType = {};
for (const t of timings) (byType[t.type || "?"] ??= []).push(t.ms);

console.log(`\n${LABEL}: ${ms.length} decisions, browser engine turnaround (ms)`);
console.log(
  `  p50 ${pct(50).toFixed(0)}   p90 ${pct(90).toFixed(0)}   p99 ${pct(99).toFixed(0)}   max ${ms[ms.length - 1].toFixed(0)}`,
);
for (const [type, list] of Object.entries(byType)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 6)) {
  const s = list.slice().sort((a, b) => a - b);
  console.log(
    `  ${type.padEnd(22)} n=${String(list.length).padStart(3)}  p50 ${s[Math.floor(s.length / 2)].toFixed(0)}  max ${s[s.length - 1].toFixed(0)}`,
  );
}
await browser.close();
