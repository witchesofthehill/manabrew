// Host-migration end-to-end test for the Ironsmith runtime.
//
// Every seat runs its own copy of the Ironsmith engine and applies the host's
// transcript, so the game does not live on the host. Two humans start a game,
// the host's browser goes away mid-game, and the relay hands the host role to
// the guest. Asserts that the guest keeps a live game and that its next answer
// is applied with no original host, instead of the game being aborted.
//
// Needs the dev server: it drives the game through `window.__gameStore`.
//
// Usage: node tests/e2e-ironsmith/ironsmith-host-migration.mjs

import { chromium } from "playwright";
import { launchOpts, readGame, waitForGame, answerPrompt, startTwoHumanGame } from "./lib.mjs";

const DECK = process.env.DECK || "Goblins";
const FORMAT = process.env.FORMAT || "Vintage";
const ROOM = "IronsmithMove" + Date.now().toString(36).slice(-4);

const browser = await chromium.launch(launchOpts());
const mkPage = async () =>
  (await browser.newContext({ viewport: { width: 1300, height: 850 } })).newPage();

try {
  const host = await mkPage();
  const guest = await mkPage();
  await startTwoHumanGame(host, guest, { room: ROOM, deck: DECK, format: FORMAT });

  // The guest draws its own view from its own engine: the room's public view,
  // which hides hands, must not be what is left on its screen.
  await guest.waitForTimeout(1500);
  const held = await readGame(guest);
  if (!held?.hand) throw new Error(`guest cannot read its own hand: ${JSON.stringify(held)}`);

  // The host's browser goes away without leaving the room.
  await host.context().close();

  // The guest now sequences the game itself: its answer is applied with no
  // original host, which hands priority to the absent seat. That seat then
  // forfeits when its reconnect window runs out, and the guest's own engine
  // ends the game. An aborted game would instead drop the guest to the lobby.
  const kind = await answerPrompt(guest);
  if (String(kind).startsWith("unhandled")) throw new Error(`guest prompt ${kind}`);
  const after = await waitForGame(
    guest,
    "the game to move on without the original host",
    (s) => s.gameOver || (s.prompt != null && s.prompt.id !== held.prompt.id),
    120000,
  );
  if (after.gameOver && after.winner !== held.me) {
    throw new Error(`game ended for the wrong seat: ${JSON.stringify(after)}`);
  }
  const outcome = after.gameOver
    ? `the absent seat forfeited and the guest won (winner ${after.winner})`
    : `the guest reached its next prompt (turn ${after.turn}, ${after.step})`;
  console.log(`PASS: game survived the host leaving; the guest hosted on and ${outcome}`);
} catch (e) {
  console.error("FAIL:", String(e?.stack || e).slice(0, 600));
  process.exitCode = 1;
} finally {
  await browser.close();
}
