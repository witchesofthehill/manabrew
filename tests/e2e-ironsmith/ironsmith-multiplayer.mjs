// End-to-end smoke test for the Ironsmith trusted runtime.
//
// Drives the real web client + a real relay: onboard, point at the local relay,
// create an Ironsmith Match room, pick an Ironsmith-validatable deck, add a bot
// on the same deck, start the game, and assert the board renders and the game
// reaches a live prompt (mulligan → priority). Exercises the host WASM game,
// per-seat views, the prompt pipeline, and bot integration.
//
// Prereqs (see README.md): relay on :9443, web client on :1420 (or set BASE),
// ironsmith submodule built + synced, and the `ironsmithRuntime` flag ON.
//
// Usage:
//   node tests/e2e-ironsmith/ironsmith-multiplayer.mjs
//   DECK="Mono Red Prison" FORMAT=Vintage node tests/e2e-ironsmith/ironsmith-multiplayer.mjs
//   HEADED=1 SHOT=/tmp/shots node tests/e2e-ironsmith/ironsmith-multiplayer.mjs
//
// Exit code 0 = game reached a live board; non-zero = failure (message on stderr).

import { chromium } from "playwright";
import {
  launchOpts,
  uniqueName,
  onboard,
  connectLocal,
  createRoom,
  pickPreset,
} from "./lib.mjs";

const DECK = process.env.DECK || "Mono Red Prison";
const FORMAT = process.env.FORMAT || "Vintage";
const SHOT = process.env.SHOT || null;

const fail = (msg) => {
  console.error("FAIL:", msg);
  process.exitCode = 1;
};

const browser = await chromium.launch(launchOpts());
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

let startError = null;
page.on("console", (m) => {
  const t = m.text();
  if (/Failed to start multiplayer|did not return|rejected match config|Ironsmith .*fatal/i.test(t)) {
    startError = t;
  }
});

try {
  const host = uniqueName();
  await onboard(page, host);
  await connectLocal(page, host);
  await createRoom(page, { name: "IronsmithE2E", engine: "Ironsmith", format: FORMAT });

  await pickPreset(page, () => page.getByRole("button", { name: /^Select Deck$/ }).click(), DECK);
  await page.getByRole("button", { name: /Add Bot/i }).click();
  await page.waitForTimeout(900);
  if (await page.locator("[role=dialog]").count()) {
    await pickPreset(page, async () => {}, DECK);
  }

  await page.getByRole("button", { name: /Start Game/i }).click();
  await page.waitForTimeout(9000);

  const onBoard = /\/play|\/game/.test(page.url()) && (await page.locator("canvas").count()) > 0;
  const hasPrompt = await page
    .getByRole("button", { name: /^(Keep|Mulligan|Pass)$/ })
    .count();

  if (SHOT) await page.screenshot({ path: `${SHOT}/ironsmith-board.png`, fullPage: true });

  if (!onBoard) {
    fail(`board did not render (url=${page.url()}). start error: ${startError ?? "none"}`);
  } else if (!hasPrompt) {
    fail("board rendered but no live prompt (Keep/Mulligan/Pass) appeared");
  } else {
    console.log(`PASS: Ironsmith game live on ${page.url()} (deck=${DECK}, format=${FORMAT})`);
  }
} catch (e) {
  fail(String(e?.stack || e).slice(0, 400) + (startError ? `\nstart error: ${startError}` : ""));
} finally {
  await browser.close();
}
