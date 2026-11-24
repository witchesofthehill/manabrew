// Three humans on one Ironsmith table whose seats are joined by real WebRTC data
// channels (the room's peer-to-peer plane) with an in-process stand-in for the
// relay. Checks that the private traffic, including the ~600 KB match config that
// is far over a data channel's 256 KiB message limit, goes over the channels; that
// a seat whose channel breaks mid-game carries on over the relay; and that a seat
// which does not advertise direct support is never sent anything over a channel.
//
// Dev server only, no relay: node tests/e2e-ironsmith/ironsmith-p2p.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launchOpts } from "./lib.mjs";

const base = process.env.BASE || "http://localhost:1420";
const names = ["Host", "Guest1", "Guest2"];
const browser = await chromium.launch({
  ...launchOpts(),
  // Same-machine peers connect on host candidates; Chrome would hide them as mDNS names.
  args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
});

const wait = async (page, predicate, ms = 45000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await page.evaluate(predicate)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Timed out: " + predicate);
};

async function newTable({ legacySeat = null } = {}) {
  const pages = [];
  for (let seat = 0; seat < names.length; seat++) {
    const page = await browser.newPage();
    pages.push(page);
    await page.route("**/__p2p", (r) =>
      r.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    page.on("console", (m) => {
      if (m.text().includes("[Ironsmith]")) console.log(seat, m.text());
    });
    // The stand-in relay: a room message goes to the seat it names, or to everyone else.
    await page.exposeFunction("relay", (envelope, broadcast = false) => {
      for (let to = 0; to < names.length; to++) {
        if (to === seat) continue;
        if (!broadcast && envelope.targetPlayer && envelope.targetPlayer !== names[to]) continue;
        void pages[to]?.evaluate(
          ({ envelope, broadcast, from }) => window.deliver?.(envelope, broadcast, from),
          { envelope, broadcast, from: names[seat] },
        );
      }
    });
    // The relay also carries the plane's offers, answers and candidates.
    await page.exposeFunction("signal", (to, payload) => {
      const peer = pages[names.indexOf(to)];
      void peer?.evaluate(({ from, payload }) => window.plane.onSignal(from, payload), {
        from: names[seat],
        payload,
      });
    });
    await page.goto(`${base}/__p2p`);
  }
  await Promise.all(
    pages.map((page, seat) =>
      page.evaluate(
        async ({ seat, names, legacy }) => {
          // The platform first: the runtime and the store import each other.
          const { getPlatform } = await import("/src/platform/index.ts");
          await import("/src/stores/useGameStore.ts");
          const { IronsmithTrustedGameApi } = await import("/src/game/ironsmithRuntime.ts");
          const { WebRtcPlane, webRtcEndpoint } = await import("/src/game/webrtcPlane.ts");
          const { expandPresetDeckDefinition } = await import("/src/lib/presetDecks.ts");
          const platform = getPlatform();
          const me = names[seat];
          window.plane = new WebRtcPlane({
            username: me,
            signal: (to, payload) => window.signal(to, payload),
            // As web.ts does: a frame off a channel takes the path a relay frame takes.
            deliver: (envelope, from) =>
              platform.events.emit("server:room_message", { from_player: from, state: envelope }),
          });
          // What each private payload cost, and which path it took.
          window.route = { plane: [], relay: [] };
          platform.server.sendRoomMessage = async (envelope, options) => {
            if (legacy && envelope.payload?.type === "hello") delete envelope.payload.direct;
            const kind = envelope.payload?.type;
            const size = JSON.stringify(envelope).length;
            if (options?.direct && window.plane.trySendDirect(envelope, envelope.targetPlayer)) {
              window.route.plane.push({ to: envelope.targetPlayer, kind, size });
              return;
            }
            if (kind === "private") window.route.relay.push({ to: envelope.targetPlayer, size });
            await window.relay(envelope);
          };
          platform.server.broadcastState = (state) => window.relay(state, true);
          window.deliver = (envelope, broadcast, from) =>
            platform.events.emit(
              broadcast ? "server:state_update" : "server:room_message",
              broadcast ? { state: envelope } : { from_player: from, state: envelope },
            );
          window.api = new IronsmithTrustedGameApi();
          window.errors = [];
          platform.events.on("game:error", (e) => window.errors.push(e));
          platform.events.on("game:fatal", (e) => window.errors.push(e));
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
          window.members = names.map((username, i) => ({
            username,
            endpoint: webRtcEndpoint(username),
            host: i === 0,
          }));
          window.keep = async () => {
            const prompt = await window.api.getPrompt();
            if (prompt?.input.type !== "mulligan") throw new Error("No mulligan");
            await window.api.respond({
              promptId: Number(prompt.promptId),
              action: { type: "mulligan", output: { type: "mulliganDecision", keep: true } },
            });
          };
        },
        { seat, names, legacy: seat === legacySeat },
      ),
    ),
  );
  // The room's roster names the host; every seat then dials, and GameStarted freezes
  // whichever channels are open.
  await Promise.all(
    pages.map((p) => p.evaluate(() => window.plane.onRoster(window.members, window.members[0]))),
  );
  await wait(pages[0], () => window.plane.serving().length === 2);
  await wait(pages[1], () => window.plane.serving().length === 1);
  await wait(pages[2], () => window.plane.serving().length === 1);
  await Promise.all(pages.map((p) => p.evaluate(() => window.plane.freeze())));
  return pages;
}

async function playToPriority(pages, { afterSync } = {}) {
  const [host, ...guests] = pages;
  await Promise.all(
    pages.map((p) => p.evaluate(() => window.api.startMultiplayerGame(window.params))),
  );
  await wait(host, () => window.api.prompts.get("player-0")?.input.type === "mulligan");
  for (const guest of guests) {
    await wait(guest, () => !window.api.needsSync && Boolean(window.api.game));
  }
  await afterSync?.();
  await host.evaluate(() => window.keep());
  await wait(guests[0], () => window.api.prompts.get("player-1")?.input.type === "mulligan");
  await guests[0].evaluate(() => window.keep());
  await wait(guests[1], () => window.api.prompts.get("player-2")?.input.type === "mulligan");
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
}

const routes = (page) => page.evaluate(() => window.route);
const close = (pages) =>
  Promise.all(pages.map((p) => p.evaluate(() => window.api?.endGame()).catch(() => {})));

try {
  {
    const pages = await newTable();
    await playToPriority(pages);
    const host = await routes(pages[0]);
    const big = host.plane.filter((m) => m.size > 262_144);
    assert.ok(big.length >= 2, "each seat's match config should travel over its channel");
    assert.equal(host.relay.length, 0, "no private payload should have used the relay");
    for (const guest of pages.slice(1)) {
      const mine = await routes(guest);
      assert.ok(
        mine.plane.some((m) => m.to === "Host"),
        "a seat should answer over its channel",
      );
      assert.equal(mine.relay.length, 0);
    }
    console.log(
      `PASS: all private traffic went over the data channels (${big.length} messages over 256 KiB)`,
    );
    await close(pages);
  }

  {
    const pages = await newTable();
    await playToPriority(pages, {
      // Guest2's channel breaks after the first sync: it must carry on over the relay.
      afterSync: async () => {
        await pages[0].evaluate(() => window.plane.peers.get("Guest2").channel.close());
      },
    });
    const host = await routes(pages[0]);
    assert.ok(
      host.plane.some((m) => m.to === "Guest1"),
      "the intact seat stays on its channel",
    );
    assert.ok(
      host.relay.some((m) => m.to === "Guest2"),
      "the broken seat falls back to the relay",
    );
    assert.equal(host.plane.filter((m) => m.to === "Guest2" && m.kind !== "private").length, 0);
    console.log("PASS: a seat whose channel breaks mid-game carries on over the relay");
    await close(pages);
  }

  {
    const pages = await newTable({ legacySeat: 2 });
    await playToPriority(pages);
    const host = await routes(pages[0]);
    assert.equal(host.plane.filter((m) => m.to === "Guest2").length, 0);
    assert.ok(host.relay.some((m) => m.to === "Guest2"));
    assert.ok(host.plane.some((m) => m.to === "Guest1"));
    console.log(
      "PASS: a seat that does not advertise direct support is never sent a channel message",
    );
    await close(pages);
  }
} finally {
  await browser.close();
}
