// UI e2e: in-game board settings + unified card sizing + scry/surveil preview.
//
// Drives a real bot game on the default (Manabrew) engine and checks:
//   1. the gear menu opens the Board settings modal,
//   2. the card size slider persists and rescales the live board,
//   3. the zone-pile lock persists,
//   4. the ScryModal shows the big hover preview and dismisses on leave.
//
// The scry step injects a prompt through the dev-only `window.__gameStore`
// seam (see the tail of src/stores/useGameStore.ts), so BASE must point at
// the vite DEV server (yarn dev / vite on :1420), not a production build.
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
} from "../e2e-ironsmith/lib.mjs";

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
await pickPreset(page, () => page.getByRole("button", { name: /^Select Deck$/ }).click(), DECK);
await page.getByRole("button", { name: /Add Bot/i }).click();
await page.waitForTimeout(900);
if (await page.locator("[role=dialog]").count()) await pickPreset(page, async () => {}, DECK);
await page.getByRole("button", { name: /Start Game/i }).click();
await page.waitForTimeout(10000);
if (!/\/play/.test(page.url())) await fail("did not reach the board");

// Clear the first-player roll + mulligan so the board is steady.
for (let i = 0; i < 30; i++) {
  const cont = page.getByRole("button", { name: /^Continue$/ }).first();
  const keep = page.getByRole("button", { name: /Keep/i }).first();
  if (await cont.count()) await cont.click().catch(() => {});
  else if (await keep.count()) {
    await keep.click().catch(() => {});
    break;
  }
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(3000);

// ── 1. Gear menu → Board settings ───────────────────────────────────────────
// The gear is Pixi (self capsule, bottom-left) — probe a few candidate points.
const canvas = page.locator("canvas").first();
const box = await canvas.boundingBox();
async function openBoardSettings() {
  for (const [dx, dy] of [
    [24, 56],
    [30, 60],
    [40, 56],
    [20, 70],
    [50, 70],
    [60, 60],
    [35, 45],
    [70, 55],
  ]) {
    await page.mouse.click(box.x + dx, box.y + box.height - dy);
    await page.waitForTimeout(600);
    if (await page.locator("text=Board settings").count()) {
      await page.locator("text=Board settings").click();
      await page.waitForTimeout(600);
      return true;
    }
  }
  return false;
}
if (!(await openBoardSettings())) await fail("gear menu / Board settings never opened");
if (!(await page.locator("text=Card size").count())) await fail("settings modal missing Card size");
console.log("ok: Board settings modal opens from the gear menu");
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

// ── 4. ScryModal big hover preview ──────────────────────────────────────────
// Inject a surveil-style scry prompt with real cards from the live gameView.
const injected = await page.evaluate(async () => {
  const useGameStore = window.__gameStore;
  if (!useGameStore) return "no __gameStore seam (BASE must be the vite dev server)";
  const s = useGameStore.getState();
  // Opponent hands are hidden (empty arrays in our view), so the player with
  // a visible hand is us — more robust than matching myPlayerSlot to an id.
  const me =
    s.gameView?.players?.find((p) => p.id === s.myPlayerSlot) ??
    s.gameView?.players?.find((p) => (p.hand ?? []).length > 0);
  const cards = (me?.hand ?? []).slice(0, 3);
  if (cards.length < 2) return "not enough hand cards";
  useGameStore.setState({
    currentPrompt: {
      promptId: "e2e-scry",
      decidingPlayerId: me.id,
      input: {
        type: "scry",
        presentation: { title: "Surveil 3", targets: [] },
        cards,
        zones: ["libraryTop", "graveyard"],
      },
    },
    isWaitingForResponse: false,
  });
  return "ok";
});
if (injected !== "ok") await fail(`could not inject scry prompt: ${injected}`);
await page.waitForTimeout(1200);
if (!(await page.locator("text=Cards to place").count())) await fail("ScryModal did not open");

const firstCard = page.locator("[data-card-id]").first();
const cb = await firstCard.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.waitForTimeout(900); // default hover delay is 500ms
if (!(await page.locator("[data-card-preview]").count()))
  await fail("hover preview did not appear in ScryModal");
if (SHOT) await page.screenshot({ path: `${SHOT}/scry-preview.png` });
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height + 250);
await page.waitForTimeout(600);
if (await page.locator("[data-card-preview]").count())
  await fail("hover preview did not dismiss on leave");
console.log("ok: scry/surveil hover preview shows and dismisses");

console.log("PASS: board settings + card sizing + scry preview");
await browser.close();
