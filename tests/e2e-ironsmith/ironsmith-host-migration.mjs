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
import {
  launchOpts,
  uniqueName,
  onboard,
  connectLocal,
  createRoom,
  enableIronsmith,
  pickPreset,
  deckButton,
} from "./lib.mjs";

const DECK = process.env.DECK || "Goblins";
const FORMAT = process.env.FORMAT || "Vintage";
const BASE = process.env.BASE || "http://localhost:1420";
const ROOM = "IronsmithMove" + Date.now().toString(36).slice(-4);

const browser = await chromium.launch(launchOpts());
const mkPage = async () =>
  (await browser.newContext({ viewport: { width: 1300, height: 850 } })).newPage();

// A compact reading of the seat's game through the dev-only store hook.
const read = (page) =>
  page.evaluate(() => {
    const s = window.__gameStore?.getState();
    const gv = s?.gameView;
    if (!gv) return null;
    const p = s.currentPrompt;
    return {
      turn: gv.turn,
      step: gv.step,
      gameOver: Boolean(gv.gameOver),
      winner: gv.winnerId ?? null,
      me: s.myPlayerSlot,
      // Cards in the seat's own hand that it can read: its private view.
      hand: (
        gv.zones.find((z) => z.zone === "hand" && z.ownerId === s.myPlayerSlot)?.cards ?? []
      ).filter((card) => card.identity?.name).length,
      prompt: p ? { id: p.promptId, type: p.input.type, who: p.decidingPlayerId } : null,
    };
  });

const waitFor = async (page, label, predicate, timeoutMs = 30000) => {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    last = await read(page).catch(() => null);
    if (last && predicate(last)) return last;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(last)}`);
};

// Answers the seat's open prompt with the least eventful legal choice.
const answer = (page) =>
  page.evaluate(async () => {
    const s = window.__gameStore.getState();
    const input = s.currentPrompt?.input;
    if (!input) return null;
    const outputs = {
      mulligan: { type: "mulliganDecision", keep: true },
      chooseAction: { type: "pass", exhaustStack: false },
    };
    const output = outputs[input.type];
    if (!output) return `unhandled:${input.type}`;
    await s.respond(output);
    return input.type;
  });

try {
  const host = await mkPage();
  const guest = await mkPage();
  const hostName = uniqueName("Host");
  const guestName = uniqueName("Guest");

  await onboard(host, hostName);
  await connectLocal(host, hostName);
  await createRoom(host, { name: ROOM, engine: "Ironsmith", format: FORMAT });
  await pickPreset(host, () => deckButton(host).click(), DECK);

  await onboard(guest, guestName);
  await connectLocal(guest, guestName);
  await enableIronsmith(guest);
  await guest.goto(BASE + "/lobby", { waitUntil: "networkidle" });
  await guest.waitForTimeout(1500);
  const row = guest.getByRole("article").filter({
    has: guest.getByRole("heading", { name: ROOM, exact: true }),
  });
  await row.waitFor({ timeout: 10000 });
  await row.getByRole("button", { name: /^Join table$/ }).click();
  await guest.waitForTimeout(2000);
  await pickPreset(guest, () => deckButton(guest).click(), DECK);
  const ready = guest.getByRole("button", { name: /^Ready( up)?$/i });
  await ready.waitFor({ timeout: 15000 });
  await ready.click();
  await guest.waitForTimeout(1000);
  await host.waitForTimeout(1000);
  await host.getByRole("button", { name: /Start (Game|Table)/i }).click();

  // Both seats build the game: the guest from the host's transcript.
  await waitFor(host, "host game", (s) => s.turn != null, 60000);
  await waitFor(guest, "guest game", (s) => s.turn != null, 90000);

  // Both keep their opening hands, so the game is past its setup.
  for (let round = 0; round < 6; round++) {
    for (const page of [host, guest]) {
      const state = await read(page);
      if (state?.prompt?.type === "mulligan" && state.prompt.who === state.me) await answer(page);
    }
    await host.waitForTimeout(700);
    const [h, g] = [await read(host), await read(guest)];
    if (h?.prompt?.type !== "mulligan" && g?.prompt?.type !== "mulligan") break;
  }
  await waitFor(guest, "guest past mulligans", (s) => s.prompt?.type !== "mulligan");
  // The host passes until the guest holds priority, so the guest has a prompt
  // of its own to answer once the host is gone.
  for (let round = 0; round < 12; round++) {
    const g = await read(guest);
    if (g?.prompt && g.prompt.who === g.me) break;
    const h = await read(host);
    if (h?.prompt && h.prompt.who === h.me) await answer(host);
    await host.waitForTimeout(500);
  }
  const before = await waitFor(guest, "guest holds priority", (s) => s.prompt?.who === s.me);
  // The guest draws its own view from its own engine: the room's public view,
  // which hides hands, must not be what is left on its screen.
  await guest.waitForTimeout(1500);
  const settled = await read(guest);
  if (!settled?.hand) throw new Error(`guest cannot read its own hand: ${JSON.stringify(settled)}`);

  // The host's browser goes away without leaving the room.
  await host.context().close();

  // The guest now sequences the game itself: its answer is applied with no
  // original host, which hands priority to the absent seat. That seat then
  // forfeits when its reconnect window runs out, and the guest's own engine
  // ends the game. An aborted game would instead drop the guest to the lobby.
  const held = await read(guest);
  if (!held?.prompt || held.prompt.who !== held.me) throw new Error("guest lost its prompt");
  const kind = await answer(guest);
  if (String(kind).startsWith("unhandled")) throw new Error(`guest prompt ${kind}`);
  const after = await waitFor(
    guest,
    "the game to move on without the original host",
    (s) => s.gameOver || s.prompt?.id !== held.prompt.id,
    120000,
  );
  const advanced = after.gameOver
    ? `the guest hosted on, the absent seat forfeited and the guest won (winner ${after.winner})`
    : `the guest hosted on and reached its next prompt (turn ${after.turn}, ${after.step})`;
  if (after.gameOver && after.winner !== held.me) {
    throw new Error(`game ended for the wrong seat: ${JSON.stringify(after)}`);
  }
  console.log(`PASS: game survived the host leaving (was turn ${before.turn}); ${advanced}`);
} catch (e) {
  console.error("FAIL:", String(e?.stack || e).slice(0, 600));
  process.exitCode = 1;
} finally {
  await browser.close();
}
