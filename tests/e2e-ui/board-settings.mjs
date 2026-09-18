// UI e2e: in-game board settings + unified card sizing.
//
// Drives a real bot game on the default (Manabrew) engine and checks:
//   1. the settings shortcut opens the Board settings modal,
//   2. the card size slider persists and rescales the live board,
//   3. the zone-pile lock persists.
//
// Prompts are answered through the dev-only `window.__gameStore` seam (see
// the tail of src/stores/useGameStore.ts), so BASE must point at the vite
// DEV server (yarn dev / vite on :1420), not a production build. The scry
// hover preview this once covered now lives on the canvas, with no DOM
// surface to assert from.
//
// Run via `cargo xtask e2e-ui` (or `node tests/e2e-ui/board-settings.mjs`).
// Prerequisites match tests/e2e-ironsmith/README.md: relay on :9443 with
// server key `forge`, web dev server on :1420, system Google Chrome.
// Env: BASE, RELAY_HOST, RELAY_PORT, RELAY_PW, DECK, SHOT (screenshot dir).
import { chromium } from "playwright";
import {
  uniqueName,
  onboard,
  connectLocal,
  createRoom,
  pickPreset,
  deckButton,
} from "../e2e-ironsmith/lib.mjs";
import { answerPrompt } from "./forgeSolo.mjs";

const SHOT = process.env.SHOT || null;
const DECK = process.env.DECK || "Izzet Lessons";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let pageError = null;
page.on("pageerror", (e) => (pageError = String(e).slice(0, 200)));

async function fail(msg) {
  if (SHOT) await page.screenshot({ path: `${SHOT}/board-settings-FAIL.png` });
  console.log(`FAIL: ${msg}${pageError ? ` (pageerror: ${pageError})` : ""}`);
  await browser.close();
  process.exit(1);
}

// ── Reach a live board vs a bot ─────────────────────────────────────────────
const NM = uniqueName();
await onboard(page, NM);
await connectLocal(page, NM);
await createRoom(page, { name: "UiSettingsE2E", engine: "Manabrew", format: "Standard" });
await pickPreset(page, () => deckButton(page).click(), DECK);
await page.getByRole("button", { name: /Add (a )?bot/i }).click();
await page.waitForTimeout(900);
if (await page.locator("[role=dialog]").count()) await pickPreset(page, async () => {}, DECK);
await page.getByRole("button", { name: /Start (Game|Table)/i }).click();
await page.waitForURL(/\/play/, { timeout: 60000 }).catch(() => {});
if (!/\/play/.test(page.url())) await fail("did not reach the board");
await page.waitForTimeout(3000);

// Clear the first-player roll + mulligan so the board is steady. Prompts are
// drawn on the canvas, so they are answered through the store.
for (let i = 0; i < 60; i++) {
  const live = await page.evaluate(
    () => window.__gameStore?.getState?.()?.currentPrompt?.input?.type ?? null,
  );
  if (live === "chooseAction") break;
  const type = await answerPrompt(page);
  await page.waitForTimeout(type ? 300 : 1000);
}
await page.waitForTimeout(3000);

// ── 1. Board settings ───────────────────────────────────────────────────────
// The game menu button lives on the canvas outside the accessibility tree,
// so the shortcut opens the modal: the same handler the menu item calls.
async function openBoardSettings() {
  await page
    .locator("body")
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  // Synthetic, so the browser's own Preferences shortcut never swallows it.
  await page.evaluate(() => {
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: ",",
        code: "Comma",
        metaKey: apple,
        ctrlKey: !apple,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const modal = page.locator("text=Board settings").first();
  await modal.waitFor({ timeout: 5000 }).catch(() => null);
  return (await modal.count()) > 0;
}
if (!(await openBoardSettings())) {
  console.log("url:", page.url());
  console.log(
    "modal:",
    await page.evaluate(
      () =>
        (window.__gameStore ? "store" : "nostore") +
        " " +
        document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
    ),
  );
  await fail("Board settings never opened");
}
if (!(await page.locator("text=Card size").count())) await fail("settings modal missing Card size");
console.log("ok: Board settings modal opens");
if (SHOT) await page.screenshot({ path: `${SHOT}/board-settings-modal.png` });

// ── 2. Card size slider + 3. zone lock persist ──────────────────────────────
const readPref = (key) =>
  page.evaluate((k) => {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (/preferences/i.test(name)) return JSON.parse(localStorage.getItem(name))?.state?.[k];
    }
  }, key);

await page.locator("[data-modal-panel] input[type=range]").first().fill("150");
await page.waitForTimeout(300);
if ((await readPref("cardSizeMultiplier")) !== 1.5)
  await fail("cardSizeMultiplier did not persist");
console.log("ok: card size slider persists (150%)");

await page.getByRole("button", { name: /^Locked$/ }).click();
await page.waitForTimeout(200);
if ((await readPref("lockZoneTiles")) !== true) await fail("lockZoneTiles did not persist");
await page.getByRole("button", { name: /^Movable$/ }).click();
console.log("ok: zone pile lock persists");

await page.getByRole("button", { name: /^Done$/ }).click();
// Long settle: the rescale re-fetches card textures at the new resolution.
await page.waitForTimeout(4000);
if (SHOT) await page.screenshot({ path: `${SHOT}/board-150.png` });

console.log("PASS: board settings + card sizing");
await browser.close();
