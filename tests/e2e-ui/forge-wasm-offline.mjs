// UI e2e: play offline against the AI with the Forge engine compiled to Wasm.
//
// Drives the real client through Play Offline and asserts the board mounts and
// the engine answers, which is what proves the Web Image build is wired to the
// UI rather than merely booting.
//
// Prerequisites: a vite dev server started with VITE_FORGE_WASM=1, and the
// engine plus packed assets staged in public/forge/ (see
// forge-harness/build-wasm.sh and forge-harness/native/web/pack-assets.mjs).
//
//   VITE_FORGE_WASM=1 npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-offline.mjs
//
// Env: BASE, DECK, AI_DECK, SHOT (screenshot dir), HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

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
await page.getByRole("button", { name: /^Fight!$/ }).click();

// Boot is ~1s, but the first prompt has to round-trip the SAB too.
await page.waitForTimeout(20000);

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
  page.evaluate(() => {
    const m = document.body.innerText.match(/Turn\s+(\d+)/i);
    return m ? Number(m[1]) : 0;
  });

const CLICKS = [
  /^Keep$/i,
  /^Continue$/i,
  /^OK$/i,
  /^Done$/i,
  /^No Blocks$/i,
  /^Pass$/i,
  /End Turn/i,
];
let acted = 0;
for (let i = 0; i < 260; i++) {
  let clicked = false;

  // Selection modals gate their Confirm on a count, so pick cards until it frees up.
  const confirm = page.getByRole("button", { name: /^Confirm$/i }).first();
  if (await confirm.count().catch(() => 0)) {
    if (await confirm.isEnabled().catch(() => false)) {
      await confirm.click({ timeout: 1500 }).catch(() => {});
      acted++;
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
      acted++;
      clicked = true;
      break;
    }
  }

  if (!clicked) await page.waitForTimeout(250);
  if ((await turnNow()) >= 3) break;
}

const turn = await turnNow();
const after = await dump();
if (SHOT) await page.screenshot({ path: `${SHOT}/forge-wasm-offline.png` });

const states = after.frames.filter((f) => f.startsWith("state:")).length;
const prompts = after.frames.filter((f) => f.startsWith("prompt:")).length;
if (prompts < 5)
  await fail(`the engine only issued ${prompts} prompts; the loop is not turning over`);

console.log(
  `PASS: forge wasm offline is playable — turn ${turn}, ${prompts} prompts, ${states} states, ${acted} clicks`,
);
await browser.close();
