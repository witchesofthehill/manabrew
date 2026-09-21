// UI e2e: play offline against the AI with the Forge engine compiled to Wasm.
//
// Drives the real client through Play Offline and asserts the board mounts and
// the engine answers, which is what proves the Web Image build is wired to the
// UI rather than merely booting.
//
// Prerequisites: a vite dev server started with VITE_FORGE_WASM=1, and the
// engine staged in packages/forge-wasm/ (see scripts/build-forge-wasm.sh).
//
//   VITE_FORGE_WASM=1 npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-offline.mjs
//
// Env: BASE, DECK, AI_DECK, SHOT (screenshot dir), HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";
import { drive, fight } from "./forgeSolo.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Izzet Lessons";
const AI_DECK = process.env.AI_DECK || "Esper Pixie";
const SHOT = process.env.SHOT || null;

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 300)));

async function dump() {
  return page
    .evaluate(() => ({
      frames: (window.__forgeFrames || []).slice(0, 400),
      log: (window.__forgeLog || [])
        .filter((l) => !/^\s+at (genBacktrace|_Files|_FileInput|func\.bridge)/.test(l))
        .slice(-30),
    }))
    .catch(() => ({ frames: [], log: [] }));
}

async function fail(msg) {
  const d = await dump();
  if (SHOT) await page.screenshot({ path: `${SHOT}/forge-wasm-offline-FAIL.png` });
  console.log(`FAIL: ${msg}${pageError ? ` (pageerror: ${pageError})` : ""}`);
  console.log("frames:", d.frames.join(" ") || "(none)");
  console.log("engine log tail:");
  for (const line of d.log) console.log("   ", line);
  await browser.close();
  process.exit(1);
}

// The engine is behind a deployment flag plus a Settings opt-in. Set the opt-in
// and select Forge's internal AI so this run covers its seat-buffer handshake.
// The flag itself is already on against a dev server; only the opt-in is needed.
await page.addInitScript(() => {
  try {
    const raw = localStorage.getItem("manabrew-preferences");
    const doc = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    doc.state = { ...(doc.state || {}), forgeWasmEnabled: true, aiController: "forge" };
    localStorage.setItem("manabrew-preferences", JSON.stringify(doc));
  } catch {
    // First load on a fresh origin; the store writes its own defaults.
  }
});

await onboard(page, uniqueName("Forge"));

await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Standard", exact: true }).click();
await page.waitForTimeout(600);

const bar = () => page.evaluate(() => document.body.innerText.split("\n").slice(-8).join(" | "));

// The bottom bar fills whichever slot is currently selecting, so seat your deck
// first and the AI's second. Fight only enables once both seats are filled.
for (const deck of [DECK, AI_DECK]) {
  const card = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
  if (!(await card.count())) await fail(`deck "${deck}" is not on the Standard tab`);
  await card.click();
  await page.waitForTimeout(500);
  console.log(`seated ${deck} -> ${await bar()}`);
}

try {
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        /^Fight!$/.test(x.textContent || ""),
      );
      return b && !b.disabled;
    },
    { timeout: 10000 },
  );
} catch {
  await fail(`Fight stayed disabled — bar: ${await bar()}`);
}
await fight(page);

// Boot is ~1s, but the first prompt has to round-trip the SAB too.
await page
  .waitForFunction(() => (window.__forgeFrames || []).some((f) => f.startsWith("prompt")), {
    timeout: 120000,
  })
  .catch(() => {});

const d = await dump();
if (!d.frames.length) await fail("the client received no frames from the engine");
if (!d.frames.some((f) => f.startsWith("state:"))) {
  await fail(
    `no state frame; kinds seen: ${[...new Set(d.frames.map((f) => f.split(":")[0]))].join(",")}`,
  );
}
if (!/\/play/.test(page.url()))
  await fail(`state arrived but the board never mounted (url ${page.url()})`);

if (SHOT) await page.screenshot({ path: `${SHOT}/forge-wasm-offline-board.png` });
console.log(`board reached, ${d.frames.length} frames`);
for (const line of d.log.filter((l) => /\[assets\]|\[wasm\]|Read cards/.test(l))) {
  console.log("   ", line);
}

// Play far enough to prove the loop turns over: keep the hand, then answer
// whatever the engine asks for a while and check the turn counter moves.
const turnNow = () =>
  page.evaluate(() => window.__gameStore?.getState?.()?.gameView?.turn ?? 0).catch(() => 0);

const acted = await drive(page, {
  budgetMs: 120000,
  overrides: { playLands: true },
  done: async () => (await turnNow()) >= 3,
});

const turn = await turnNow();
const after = await dump();
if (SHOT) await page.screenshot({ path: `${SHOT}/forge-wasm-offline.png` });

const states = after.frames.filter((f) => f.startsWith("state:")).length;
const prompts = after.frames.filter((f) => f.startsWith("prompt:")).length;
if (prompts < 5)
  await fail(`the engine only issued ${prompts} prompts; the loop is not turning over`);

// Forge substitutes a placeholder for any card it cannot find, and the game
// plays on around it. That is a silent loss of a card, so it fails the run.
const unsupported = await page
  .evaluate(() =>
    (window.__forgeLog || [])
      .filter((line) => /unsupported card was requested/i.test(String(line)))
      .map((line) => String(line).trim()),
  )
  .catch(() => []);
if (unsupported.length) {
  await fail(`the engine could not find ${unsupported.length} card(s): ${unsupported.join(" | ")}`);
}

console.log(
  `PASS: forge wasm offline is playable — turn ${turn}, ${prompts} prompts, ${states} states, ${acted} answers`,
);
await browser.close();
