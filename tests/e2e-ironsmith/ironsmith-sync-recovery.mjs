// Three humans on one Ironsmith table, joined by an in-process relay. Two things
// went wrong with three or more humans on real connections:
//   1. A seat re-asked for the transcript every 2 s until it had applied the
//      first copy, and the host answered every ask with the whole match config.
//   2. An entry that never reached a seat was never sent again, so the host waited
//      on a seat that waited on the host, with nothing on the wire.
// This checks that a seat asking again draws at most one more copy of the match
// config, and that a seat which loses the first entry still gets it.
//
// Dev server only, no relay: node tests/e2e-ironsmith/ironsmith-sync-recovery.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launchOpts } from "./lib.mjs";

const base = process.env.BASE || "http://localhost:1420";
const names = ["Host", "Guest1", "Guest2"];
const browser = await chromium.launch(launchOpts());
const pages = [];
const wait = async (page, predicate, ms = 40000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(predicate)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out: " + predicate);
};
try {
  for (let seat = 0; seat < names.length; seat++) {
    const page = await browser.newPage();
    pages.push(page);
    await page.route("**/__sync-recovery", (r) =>
      r.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    page.on("console", (m) => {
      if (m.text().includes("[Ironsmith]")) console.log(seat, m.text());
    });
    await page.exposeFunction("relay", async (envelope, broadcast = false) => {
      for (let to = 0; to < names.length; to++) {
        if (to === seat) continue;
        if (!broadcast && envelope.targetPlayer && envelope.targetPlayer !== names[to]) continue;
        void pages[to]?.evaluate(
          ({ envelope, broadcast, from }) => window.deliver?.(envelope, broadcast, from),
          { envelope, broadcast, from: names[seat] },
        );
      }
    });
    await page.goto(`${base}/__sync-recovery`);
    await page.evaluate(
      async ({ seat, names }) => {
        // The platform first: the runtime and the store import each other.
        const { getPlatform } = await import("/src/platform/index.ts");
        await import("/src/stores/useGameStore.ts");
        const { IronsmithTrustedGameApi } = await import("/src/game/ironsmithRuntime.ts");
        const { expandPresetDeckDefinition } = await import("/src/lib/presetDecks.ts");
        const platform = getPlatform();
        platform.server.sendRoomMessage = (envelope) => window.relay(envelope);
        platform.server.broadcastState = (state) => window.relay(state, true);
        window.deliver = (envelope, broadcast, from) =>
          platform.events.emit(
            broadcast ? "server:state_update" : "server:room_message",
            broadcast ? { state: envelope } : { from_player: from, state: envelope },
          );
        window.api = new IronsmithTrustedGameApi();
        window.errors = [];
        platform.events.on("game:error", (error) => window.errors.push(error));
        platform.events.on("game:fatal", (error) => window.errors.push(error));
        // What the host sends each seat, and one entry per seat that never arrives.
        window.fullSyncs = {};
        window.droppedEntries = new Set();
        window.dropFirstEntry = false;
        const send = window.api.sendPrivateRelay.bind(window.api);
        window.api.sendPrivateRelay = async (to, payload) => {
          if (payload.type === "sync" && payload.config) {
            window.fullSyncs[to] = (window.fullSyncs[to] ?? 0) + 1;
          }
          if (payload.type === "entry" && window.dropFirstEntry && !window.droppedEntries.has(to)) {
            window.droppedEntries.add(to);
            return true;
          }
          return send(to, payload);
        };
        const deck = expandPresetDeckDefinition({
          ...(await (await fetch("/preset_decks/ironsmith_vintage_106774.json")).json()),
          id: "ironsmith_vintage_106774",
        });
        window.params = {
          playerNames: names,
          decks: names.map(() => deck),
          commanderNames: names.map(() => null),
          startingLife: 20,
          format: "Vintage",
          enginePlayerIndex: seat,
          localIsHost: seat === 0,
          hostPlayerSlot: "player-0",
          botPlayerSlots: [],
        };
        window.keep = async () => {
          const prompt = await window.api.getPrompt();
          if (prompt?.input.type !== "mulligan") throw new Error("No mulligan");
          await window.api.respond({
            promptId: Number(prompt.promptId),
            action: { type: "mulligan", output: { type: "mulliganDecision", keep: true } },
          });
        };
      },
      { seat, names },
    );
  }
  const [host, ...guests] = pages;
  await Promise.all(
    pages.map((p) => p.evaluate(() => window.api.startMultiplayerGame(window.params))),
  );
  await wait(host, () => window.api.prompts.get("player-0")?.input.type === "mulligan");
  for (const guest of guests) {
    await wait(guest, () => !window.api.needsSync && Boolean(window.api.game));
  }

  // A seat that asks again while its first sync is still being applied must not
  // draw another copy of the match config for each ask.
  const sentTo = (slot) => host.evaluate((slot) => window.fullSyncs[slot] ?? 0, slot);
  const before = await sentTo("player-1");
  await guests[0].evaluate(() => {
    for (let i = 0; i < 5; i++) window.api.requestSync(true);
  });
  await new Promise((r) => setTimeout(r, 2000));
  const extra = (await sentTo("player-1")) - before;
  assert.ok(extra <= 1, `five quick asks drew ${extra} more copies of the match config`);
  console.log(`PASS: five quick sync requests drew ${extra} more copies of the match config`);
  await wait(guests[0], () => !window.api.needsSync && Boolean(window.api.game));

  // The host answers its mulligan, but the entry never reaches either seat.
  await host.evaluate(() => {
    window.dropFirstEntry = true;
  });
  await host.evaluate(() => window.keep());
  await host.waitForFunction(() => window.droppedEntries.size === 2);
  // The next seat to decide must still get its prompt: the host's heartbeat shows
  // it is behind, and it asks for the entry it missed.
  await wait(guests[0], () => window.api.prompts.get("player-1")?.input.type === "mulligan", 30000);
  await guests[0].evaluate(() => window.keep());
  await wait(guests[1], () => window.api.prompts.get("player-2")?.input.type === "mulligan", 30000);
  await guests[1].evaluate(() => window.keep());
  await wait(host, () => window.api.prompts.get("player-0")?.input.type === "chooseAction");

  const states = await Promise.all(
    pages.map((page) =>
      page.evaluate(async () => ({
        entries: window.api.entries,
        state: await window.api.readPublicState(),
        errors: window.errors,
      })),
    ),
  );
  assert.deepEqual(states[1], states[0]);
  assert.deepEqual(states[2], states[0]);
  assert.deepEqual(states[0].errors, []);
  console.log("PASS: a seat that missed an entry catches up and the table reaches priority");
} finally {
  await Promise.all(pages.map((p) => p.evaluate(() => window.api?.endGame()).catch(() => {})));
  await browser.close();
}
