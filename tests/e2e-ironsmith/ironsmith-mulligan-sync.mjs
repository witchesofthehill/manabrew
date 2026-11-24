import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launchOpts } from "./lib.mjs";
const base = process.env.BASE || "http://localhost:1420";
const browser = await chromium.launch(launchOpts());
const pages = [];
const wait = async (page, predicate) => {
  const until = Date.now() + 20000;
  while (Date.now() < until) {
    if (await page.evaluate(predicate)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Timed out: " + predicate);
};
try {
  for (let seat = 0; seat < 2; seat++) {
    const page = await browser.newPage();
    pages.push(page);
    await page.route("**/__mulligan-sync", (r) =>
      r.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
    );
    page.on("console", (m) => {
      if (m.text().includes("[Ironsmith]")) console.log(seat, m.text());
    });
    await page.exposeFunction("relay", async (envelope, broadcast = false) => {
      const peer = pages[1 - seat];
      if (!peer) return;
      await peer.evaluate(
        ({ envelope, broadcast, from }) => window.deliver?.(envelope, broadcast, from),
        { envelope, broadcast, from: seat === 0 ? "Host" : "Guest" },
      );
    });
    await page.goto(`${base}/__mulligan-sync`);
    await page.evaluate(async (seat) => {
      const { IronsmithTrustedGameApi } = await import("/src/game/ironsmithRuntime.ts");
      const { getPlatform } = await import("/src/platform/index.ts");
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
      window.prompts = [];
      window.errors = [];
      window.syncs = 0;
      const applySync = window.api.applySync.bind(window.api);
      window.api.applySync = async (payload) => {
        await applySync(payload);
        window.syncs++;
      };
      platform.events.on("game:error", (error) => window.errors.push(error));
      platform.events.on("game:prompt", (prompt) =>
        window.prompts.push({ id: prompt.promptId, type: prompt.input.type }),
      );
      platform.events.on("game:fatal", (error) => window.errors.push(error));
      const deck = expandPresetDeckDefinition({
        ...(await (await fetch("/preset_decks/ironsmith_vintage_106774.json")).json()),
        id: "ironsmith_vintage_106774",
      });
      window.params = {
        playerNames: ["Host", "Guest"],
        decks: [deck, deck],
        commanderNames: [null, null],
        startingLife: 20,
        format: "Vintage",
        enginePlayerIndex: seat,
        localIsHost: seat === 0,
        hostPlayerSlot: "player-0",
        botPlayerSlots: [],
      };
      window.send = window.api.sendPrivateRelay.bind(window.api);
      window.api.sendPrivateRelay = async (to, payload) => {
        if ((window.holdNextSync || window.holdSync) && payload.type === "sync") {
          window.holdNextSync = false;
          window.held = { to, payload };
          return true;
        }
        return window.send(to, payload);
      };
      window.keep = async () => {
        const prompt = await window.api.getPrompt();
        if (prompt?.input.type !== "mulligan") throw new Error("No mulligan");
        await window.api.respond({
          promptId: Number(prompt.promptId),
          action: { type: "mulligan", output: { type: "mulliganDecision", keep: true } },
        });
      };
    }, seat);
  }
  const [host, guest] = pages;
  await Promise.all(
    pages.map((p) => p.evaluate(() => window.api.startMultiplayerGame(window.params))),
  );
  await wait(host, () => window.api.prompts.get("player-0")?.input.type === "mulligan");
  await host.evaluate(() => window.keep());
  await wait(guest, () => window.api.prompts.get("player-1")?.input.type === "mulligan");
  await host.evaluate(() => {
    window.holdNextSync = true;
  });
  await guest.evaluate(() => window.api.requestSync(true));
  await wait(host, () => Boolean(window.held));
  await guest.evaluate(() => window.keep());
  await wait(guest, () => window.api.entries.length === 2 && !window.api.needsSync);
  const snapshot = await host.evaluate(() => ({
    type: "sync",
    config: window.api.config,
    from: 0,
    entries: window.api.entries,
    more: false,
  }));
  await guest.evaluate(() => {
    window.engineBefore = window.api.game;
    window.promptsBefore = window.prompts.length;
  });
  const deliverSync = async (payload) => {
    const before = await guest.evaluate(() => window.syncs);
    await host.evaluate((payload) => window.send("player-1", payload), payload);
    await guest.waitForFunction((before) => window.syncs > before, before, { timeout: 20000 });
  };
  const assertKept = async () => {
    const state = await guest.evaluate(() => ({
      entries: window.api.entries.length,
      prompt: window.api.prompts.get("player-1")?.input.type ?? null,
      needsSync: window.api.needsSync,
      errors: window.errors,
    }));
    assert.equal(state.entries, 2);
    assert.notEqual(state.prompt, "mulligan");
    assert.equal(state.needsSync, false);
    assert.deepEqual(state.errors, []);
  };
  const stale = await host.evaluate(() => window.held.payload);
  for (let repeat = 0; repeat < 5; repeat++) {
    await deliverSync(stale);
    await assertKept();
    await deliverSync(snapshot);
    await assertKept();
  }
  assert.equal(
    await guest.evaluate(() => window.engineBefore === window.api.game),
    true,
    "Late snapshots replaced the healthy engine",
  );
  assert.equal(
    await guest.evaluate(() => window.promptsBefore === window.prompts.length),
    true,
    "Late snapshots repeated the mulligan prompt",
  );
  console.log("PASS: delayed and duplicate startup snapshots preserve both keeps");

  await deliverSync({ ...stale, more: true });
  await deliverSync({ type: "sync", from: 1, entries: snapshot.entries.slice(1), more: false });
  await assertKept();
  assert.equal(await guest.evaluate(() => window.engineBefore === window.api.game), true);
  console.log("PASS: delayed chunked sync preserves the healthy engine");

  await host.evaluate(() => {
    window.holdSync = true;
    window.held = null;
  });
  await guest.evaluate(() => window.api.requestSync(true));
  await wait(host, () => Boolean(window.held));
  await deliverSync({ ...snapshot, entries: snapshot.entries.slice(0, 1), more: true });
  assert.deepEqual(
    await guest.evaluate(() => ({
      entries: window.api.entries.length,
      needsSync: window.api.needsSync,
      replaced: window.api.game !== window.engineBefore,
    })),
    { entries: 1, needsSync: true, replaced: true },
  );
  await deliverSync({ type: "sync", from: 1, entries: snapshot.entries.slice(1), more: false });
  await assertKept();
  console.log("PASS: requested chunked restart rebuilds and catches up");

  await host.evaluate(() => {
    window.holdSync = true;
    window.held = null;
  });
  await guest.evaluate(() => window.api.requestSync(false));
  await wait(host, () => Boolean(window.held));
  await deliverSync(stale);
  assert.deepEqual(
    await guest.evaluate(() => ({
      entries: window.api.entries.length,
      needsSync: window.api.needsSync,
      prompt: window.api.prompts.get("player-1")?.input.type,
    })),
    { entries: 1, needsSync: false, prompt: "mulligan" },
  );
  await deliverSync({ type: "sync", from: 1, entries: snapshot.entries.slice(1), more: false });
  await assertKept();
  console.log("PASS: requested authoritative rollback remains supported");

  await host.evaluate(async () => {
    const prompt = await window.api.getPrompt();
    if (prompt?.input.type !== "chooseAction") throw new Error("Host did not reach priority");
    await window.api.respond({
      promptId: Number(prompt.promptId),
      action: { type: "chooseAction", output: { type: "pass", exhaustStack: false } },
    });
  });
  await wait(guest, () => window.api.prompts.get("player-1")?.input.type === "chooseAction");
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
  assert.deepEqual(states[0].errors, []);
  assert.equal(
    states[0].entries.some((entry) => entry.rejected),
    false,
  );
  console.log("PASS: both humans continue into priority with matching transcripts");
} finally {
  await Promise.all(pages.map((p) => p.evaluate(() => window.api?.endGame()).catch(() => {})));
  await browser.close();
}
