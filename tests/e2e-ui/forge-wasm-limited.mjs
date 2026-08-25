// The browser Forge engine only answers a game. The card database queries and
// the whole limited surface have no Forge implementation, and the worker used
// to answer them with null: opening Limited with the engine on took the page
// down with "Cannot read properties of null (reading 'length')".
//
//   npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-limited.mjs
//
// Env: BASE, ENGINE=forge|rust, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
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

await onboard(page, uniqueName("Lim"));
await page.goto(`${BASE}/play/offline/limited`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
if (/Something went wrong/i.test(body)) {
  await fail(`the Limited page crashed with the ${ENGINE} engine selected: ${body.slice(0, 160)}`);
}

// The set list comes from a worker command, so an unanswered one shows up as an
// empty page rather than an error.
const sets = await page
  // With Forge selected the first limited command pays for the whole card
  // archive, so this is a download wait, not a render wait.
  .waitForFunction(() => /\d+ sets available/i.test(document.body.innerText), { timeout: 180000 })
  .then(() => true)
  .catch(() => false);
if (!sets) {
  await fail(`no set list on the Limited page with the ${ENGINE} engine: ${body.slice(0, 200)}`);
}

const count = (await page.evaluate(() => document.body.innerText)).match(/(\d+) sets available/i);
console.log(
  `PASS: Limited works with the ${ENGINE} engine — ${count ? count[1] : "?"} sets listed`,
);
await browser.close();
