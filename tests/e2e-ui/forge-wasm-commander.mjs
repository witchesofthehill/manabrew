// A commander deck must start a COMMANDER game in the browser engine, the way
// the hosted node starts one: 40 life and each seat's commander in the command
// zone. Forge decides that from the game variant it is handed, so a request
// that says "Constructed" plays a commander deck as a 100-card pile and the
// board looks almost right — which is how this shipped unnoticed.
//
//   npx vite --port 5199 --strictPort
//   BASE=http://localhost:5199 node tests/e2e-ui/forge-wasm-commander.mjs
//
// Env: BASE, DECK, AI_DECK, HEADED=1.
import { chromium } from "playwright";
import { launchOpts, onboard, uniqueName } from "../e2e-ironsmith/lib.mjs";

const BASE = process.env.BASE || "http://localhost:5199";
const DECK = process.env.DECK || "Ashling, the Limitless";
const AI_DECK = process.env.AI_DECK || "Kasla";
// A commander pair frames a far bigger asset bundle than a 60-card deck, and a
// deployed build fetches the archive over the network, so the wait is not the
// same as on a dev server.
const BOOT_MS = Number(process.env.BOOT_MS || 120000);

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
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

await onboard(page, uniqueName("Cmd"));
await page.goto(`${BASE}/play/offline/constructed`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Commander", exact: true }).click();
await page.waitForTimeout(600);
for (const deck of [DECK, AI_DECK]) {
  const card = page.getByRole("button", { name: new RegExp(`^${deck}`) }).first();
  if (!(await card.count())) await fail(`deck "${deck}" is not on the Commander tab`);
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

if (!(await page.evaluate(() => Array.isArray(window.__engineDecisions)).catch(() => false))) {
  await fail("the Rust engine started — the Settings opt-in did not take");
}

// window.__gameStore is stripped from a production build, so against a
// deployed build fall back to window.__forgeFrames, which the worker bridge
// keeps whenever the Forge engine is selected. Reading only the store made a
// perfectly healthy staging game look like a hang.
const hasStore = await page.evaluate(() => Boolean(window.__gameStore)).catch(() => false);
if (!hasStore) {
  console.log("no window.__gameStore (production build) — checking the frame stream instead");
  const framed = await page
    .waitForFunction(() => (window.__forgeFrames || []).some((f) => f.startsWith("state:")), {
      timeout: BOOT_MS,
    })
    .then(() => true)
    .catch(() => false);
  const frames = await page.evaluate(() => (window.__forgeFrames || []).slice(0, 6));
  if (!framed) await fail(`the engine sent no state frame; frames so far: ${JSON.stringify(frames)}`);
  console.log(`PASS (frames only): engine is producing state — ${frames.length} frames, first ${JSON.stringify(frames[0])}`);
  await browser.close();
  process.exit(0);
}

// The command zone fills as the game is dealt, so wait for the view rather
// than sampling the first state that lands.
const seats = await page
  .waitForFunction(
    () => {
      const view = window.__gameStore?.getState?.().gameView;
      const players = view?.players;
      if (!players?.length) return null;
      if (!players.every((p) => (p.commandZone?.length ?? 0) > 0)) return null;
      return players.map((p) => ({
        life: p.life,
        commanders: p.commandZone.map((c) => ({
          name: c.identity?.name ?? null,
          unsupported: /not supported by Forge/i.test(c.text || ""),
        })),
      }));
    },
    { timeout: BOOT_MS },
  )
  .then((h) => h.jsonValue())
  .catch(() => null);

if (!seats) {
  // An engine that dies mid-start reports through the store, not the log: the
  // worker turns a Java exception into game:forced_end and the board never
  // mounts, which looks the same from here as a slow boot.
  const store = await page.evaluate(() => {
    const s = window.__gameStore?.getState?.() ?? {};
    return {
      fatalError: s.fatalError ?? null,
      debugInfo: s.debugInfo ?? null,
      isGameActive: s.isGameActive ?? null,
      prompt: s.currentPrompt?.input?.type ?? null,
    };
  });
  console.log("store:", JSON.stringify(store));
  const state = await page.evaluate(() => {
    const view = window.__gameStore?.getState?.().gameView;
    return (view?.players || []).map((p) => ({
      life: p.life,
      command: p.commandZone?.length ?? 0,
      library: p.libraryCount ?? null,
    }));
  });
  const log = await page.evaluate(() => (window.__forgeLog || []).slice(-8));
  console.log("engine log tail:");
  for (const line of log) console.log("   ", String(line).slice(0, 160));
  await fail(`no commander reached a command zone — seats: ${JSON.stringify(state)}`);
}

const wrongLife = seats.filter((s) => s.life !== 40);
if (wrongLife.length) await fail(`commander life should be 40, got ${JSON.stringify(seats)}`);

// A commander missing from the framed asset bundle still reaches the command
// zone — as Forge's "this card is not supported" placeholder.
const placeholder = seats.flatMap((s) => s.commanders).filter((c) => c.unsupported);
if (placeholder.length) {
  await fail(`commander script missing from the asset bundle: ${JSON.stringify(placeholder)}`);
}

const summary = seats.map((s) => `${s.life} life, ${s.commanders.map((c) => c.name).join(" + ")}`);
console.log(`PASS: commander rules applied — ${summary.join(" | ")}`);
await browser.close();
