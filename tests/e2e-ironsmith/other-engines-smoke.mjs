// Usage: yarn test:e2e:engines
import { chromium } from "playwright";
import {
  uniqueName,
  onboard,
  connectLocal,
  createRoom,
  pickPreset,
  deckButton,
  pickBotPreset,
  livePromptType,
} from "./lib.mjs";

const SHOT = process.env.SHOT || null;
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
await createRoom(page, { name: "ForgeSmoke", format: FORMAT });
await pickPreset(page, () => deckButton(page).click(), DECK);
await pickBotPreset(page, DECK);
await page.getByRole("button", { name: /Start (Game|Table)/i }).click();
const board = page.locator("canvas");
const boardReady = await page
  .waitForURL(/\/play(?:[/?#]|$)/, { timeout: 60000 })
  .then(() => board.first().waitFor({ state: "visible", timeout: 60000 }))
  .then(
    () => true,
    () => false,
  );

const url = page.url();
const canvas = await board.count();
const live = await livePromptType(page);
const prompt = live.checked ? (live.type ?? "none") : "not checked: no dev game store";
if (SHOT) await page.screenshot({ path: `${SHOT}/engine-Forge.png`, fullPage: true });
const onBoard =
  boardReady && /\/play|\/game/.test(url) && canvas > 0 && (!live.checked || Boolean(live.type));
console.log(
  `ENGINE=Forge deck=${DECK} url=${url} canvas=${canvas} prompt=${prompt} -> ${onBoard ? "PLAYS ✓" : "FAILED ✗"}`,
);
if (!onBoard) console.log("  err:", err ?? "(none)");
await browser.close();
process.exitCode = onBoard ? 0 : 1;
