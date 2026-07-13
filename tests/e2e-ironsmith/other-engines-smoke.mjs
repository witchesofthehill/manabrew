// Regression guard: confirm the non-Ironsmith engines still start a game.
// The Ironsmith work touches vite.config's wasm handling (assetsInclude +
// optimizeDeps), which also governs how the Manabrew engine wasm is served —
// so the default engine must keep loading and playing. Run with the
// `ironsmithRuntime` flag OFF (the shipped default) to mirror production.
//
// Usage: node tests/e2e-ironsmith/other-engines-smoke.mjs           # Manabrew
//        ENGINE=Ironsmith node tests/e2e-ironsmith/other-engines-smoke.mjs
import { chromium } from "playwright";
import { uniqueName, onboard, connectLocal, createRoom, pickPreset, controls } from "./lib.mjs";

const SHOT = process.env.SHOT || null;
const engine = process.env.ENGINE || "Manabrew";
const DECK = process.env.DECK || "Izzet Lessons";
const FORMAT = process.env.FORMAT || "Standard";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let err = null;
page.on("console", (m) => {
  const t = m.text();
  if (/Failed to start|did not|CompileError|magic|instantiate|fatal|Error:/i.test(t)) err = t;
});
page.on("pageerror", (e) => (err = "PAGEERROR " + String(e).slice(0, 160)));

const NM = uniqueName();
await onboard(page, NM);
await connectLocal(page, NM);
await createRoom(page, { name: engine + "Smoke", engine, format: FORMAT });
await pickPreset(page, () => page.getByRole("button", { name: /^Select Deck$/ }).click(), DECK);
await page.getByRole("button", { name: /Add Bot/i }).click();
await page.waitForTimeout(900);
if (await page.locator("[role=dialog]").count()) await pickPreset(page, async () => {}, DECK);
await page.getByRole("button", { name: /Start Game/i }).click();
await page.waitForTimeout(10000);

const url = page.url();
const canvas = await page.locator("canvas").count();
const prompt = (await controls(page)).filter((c) => /Keep|Mulligan|Pass|Play/i.test(c)).length;
if (SHOT) await page.screenshot({ path: `${SHOT}/engine-${engine}.png`, fullPage: true });
const onBoard = /\/play|\/game/.test(url) && canvas > 0 && prompt > 0;
console.log(`ENGINE=${engine} deck=${DECK} url=${url} canvas=${canvas} prompt=${prompt} -> ${onBoard ? "PLAYS ✓" : "FAILED ✗"}`);
if (!onBoard) console.log("  err:", err ?? "(none)");
await browser.close();
process.exitCode = onBoard ? 0 : 1;
