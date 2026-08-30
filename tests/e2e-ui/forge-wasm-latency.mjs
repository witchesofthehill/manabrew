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
// Env: BASE, DECK, AI_DECK, LABEL, SAMPLES, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const AI_DECK = process.env.AI_DECK || "Esper Pixie";
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
await page.waitForTimeout(20000);

const count = () => page.evaluate(() => (window.__promptTimings || []).length);
const CLICKS = [
  /^Keep$/i,
  /^Continue$/i,
  /^OK$/i,
  /^Done$/i,
  /^No Blocks$/i,
  /^Pass$/i,
  /End Turn/i,
];

for (let i = 0; i < 900 && (await count()) < SAMPLES; i++) {
  let clicked = false;
  const confirm = page.getByRole("button", { name: /^Confirm$/i }).first();
  if (await confirm.count().catch(() => 0)) {
    if (await confirm.isEnabled().catch(() => false)) {
      await confirm.click({ timeout: 1500 }).catch(() => {});
      clicked = true;
    } else {
      const card = page.locator("[role=dialog] img, [role=dialog] [data-card-id]").first();
      if (await card.count().catch(() => 0)) {
        await card.click({ timeout: 1500 }).catch(() => {});
        clicked = true;
      }
    }
  }
  if (!clicked) {
    for (const rx of CLICKS) {
      const b = page.getByRole("button", { name: rx }).first();
      if (!(await b.count().catch(() => 0))) continue;
      if (!(await b.isEnabled().catch(() => false))) continue;
      await b.click({ timeout: 1500 }).catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) await page.waitForTimeout(200);
}

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
