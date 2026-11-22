// Reload-rejoin end-to-end test for the Ironsmith runtime.
//
// A seat that reloads its page loses its engine, but not the game: every seat
// holds the transcript, so the returning seat rebuilds its engine from whoever
// hosts. Two cases, each in its own game:
//   1. the guest reloads and comes back to the same game;
//   2. the host reloads: the relay hands the room to the guest, and the old
//      host comes back as a guest of the game it started.
// In both, the returning seat must read its own hand again and the game must
// accept another answer afterwards.
//
// Needs the dev server: it drives the game through `window.__gameStore`.
//
// Usage: node tests/e2e-ironsmith/ironsmith-reload-rejoin.mjs

import { chromium } from "playwright";
import { launchOpts, readGame, waitForGame, answerPrompt, startTwoHumanGame } from "./lib.mjs";

const DECK = process.env.DECK || "Goblins";
const FORMAT = process.env.FORMAT || "Vintage";
const stamp = Date.now().toString(36).slice(-4);

const browser = await chromium.launch(launchOpts());
const mkPage = async () =>
  (await browser.newContext({ viewport: { width: 1300, height: 850 } })).newPage();

// Reloads `reloader` while `holder` holds priority, then checks the reloaded
// seat is back in the same game and that the holder's answer still applies.
async function reloadCase(label, reloaderRole) {
  const host = await mkPage();
  const guest = await mkPage();
  const holderRole = reloaderRole === "guest" ? "host" : "guest";
  await startTwoHumanGame(host, guest, {
    room: `Iron${label}${stamp}`,
    deck: DECK,
    format: FORMAT,
    holder: holderRole,
  });
  const seats = { host, guest };
  const reloader = seats[reloaderRole];
  const holder = seats[holderRole];
  const before = await readGame(reloader);

  await reloader.reload({ waitUntil: "domcontentloaded" });
  const back = await waitForGame(
    reloader,
    `${reloaderRole} back in its game after a reload`,
    (s) => s.turn === before.turn && s.hand > 0,
    90000,
  );
  if (back.me !== before.me) throw new Error(`${reloaderRole} came back as ${back.me}`);
  if (back.hand !== before.hand) {
    throw new Error(
      `${reloaderRole} hand changed across the reload: ${before.hand} → ${back.hand}`,
    );
  }

  if (back.error) throw new Error(`${reloaderRole} rebuilt a different game: ${back.error}`);

  // The game goes on: priority reaches the returned seat, which answers, and
  // its answer hands priority back to the other seat as a new prompt.
  const open = (s) => s.prompt?.type === "chooseAction" && s.prompt.who === s.me;
  for (let round = 0; round < 12 && !open((await readGame(reloader)) ?? {}); round++) {
    const state = await readGame(holder);
    if (state && open(state)) await answerPrompt(holder);
    await holder.waitForTimeout(500);
  }
  await waitForGame(reloader, `${reloaderRole} to receive priority after rejoining`, open);
  const seen = (await readGame(holder)).lastPromptId;
  await answerPrompt(reloader);
  await waitForGame(
    holder,
    `${reloaderRole}'s answer to reach the ${holderRole}`,
    (s) => s.gameOver || (open(s) && s.prompt.id !== seen),
    30000,
  );
  await host.context().close();
  await guest.context().close();
  return `${reloaderRole} reloaded on turn ${before.turn} and played on with ${back.hand} cards in hand`;
}

try {
  const guestCase = await reloadCase("GuestReload", "guest");
  const hostCase = await reloadCase("HostReload", "host");
  console.log(`PASS: ${guestCase}; ${hostCase}`);
} catch (e) {
  console.error("FAIL:", String(e?.stack || e).slice(0, 700));
  process.exitCode = 1;
} finally {
  await browser.close();
}
