import assert from "node:assert/strict";
import { chromium } from "playwright";
import { launchOpts } from "./lib.mjs";

const base = process.env.BASE || "http://localhost:1420";
const browser = await chromium.launch(launchOpts());
try {
  const page = await browser.newPage();
  let workersCreated = 0;
  const liveWorkers = new Set();
  const workerClosures = [];
  page.on("worker", (worker) => {
    if (!worker.url().includes("ironsmith.worker")) return;
    workersCreated += 1;
    liveWorkers.add(worker);
    worker.on("close", () => liveWorkers.delete(worker));
    workerClosures.push(new Promise((resolve) => worker.once("close", resolve)));
  });
  await page.route("**/__ironsmith-manabot", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto(`${base}/__ironsmith-manabot`);
  const results = await page.evaluate(async () => {
    const { IronsmithTrustedGameApi } = await import("/src/game/ironsmithRuntime.ts");
    const { getPlatform } = await import("/src/platform/index.ts");
    const { expandPresetDeckDefinition } = await import("/src/lib/presetDecks.ts");
    const preset = await (await fetch("/preset_decks/ironsmith_vintage_106774.json")).json();
    const deck = expandPresetDeckDefinition({ ...preset, id: "ironsmith_vintage_106774" });
    const randomValues = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (values) => {
      randomValues(values);
      if (values instanceof Uint32Array && values.length === 1) values[0] = 42;
      return values;
    };
    const api = new IronsmithTrustedGameApi();
    const results = [];
    for (const scenario of [
      { name: "solo", local: 0, players: 2, bots: [1] },
      { name: "multiplayer", local: 1, players: 3, bots: [0, 2] },
      { name: "takeover", local: 1, players: 3, bots: [0] },
      { name: "humans", local: 0, players: 2, bots: [] },
    ]) {
      let view;
      let prompt;
      const errors = [];
      const seats = Object.fromEntries(
        scenario.bots.map((index) => [`player-${index}`, { land: false, creature: false }]),
      );
      let combat = false;
      let damage = false;
      const events = getPlatform().events;
      const unsubscribe = [
        events.on("game:state", ({ gameView }) => {
          view = gameView;
          for (const [slot, seen] of Object.entries(seats)) {
            const cards =
              view.zones.find((zone) => zone.zone === "battlefield" && zone.ownerId === slot)
                ?.cards ?? [];
            seen.land ||= cards.some((card) => card.types?.includes("Land"));
            seen.creature ||= cards.some((card) => card.types?.includes("Creature"));
            combat ||= cards.some((card) => card.isAttacking);
          }
          damage ||= view.players.some(
            (player) => player.id === `player-${scenario.local}` && player.life < 20,
          );
        }),
        events.on("game:prompt", (value) => {
          prompt = value;
          combat ||= value.input.type === "chooseBlockers" && value.input.attackers.length > 0;
        }),
        events.on("game:error", (error) => errors.push(error)),
        events.on("game:fatal", (error) => errors.push(error)),
      ];
      let timer;
      try {
        const play = async () => {
          if (scenario.name === "solo") {
            await api.startGame({
              deck,
              commanderName: null,
              opponentDecks: [deck],
              startingLife: 20,
            });
          } else {
            await api.startMultiplayerGame({
              playerNames: Array.from({ length: scenario.players }, (_, index) => `Seat ${index}`),
              decks: Array.from({ length: scenario.players }, () => deck),
              commanderNames: Array.from({ length: scenario.players }, () => null),
              startingLife: 20,
              format: "Vintage",
              enginePlayerIndex: scenario.local,
              localIsHost: true,
              botPlayerSlots: scenario.bots.map((index) => `player-${index}`),
            });
          }
          if (scenario.name === "takeover") {
            for (const index of [1, 2]) {
              const { prompt: opening } = await api.readManabrewView(index);
              if (opening?.input.type !== "mulligan") throw new Error("Expected opening hand");
              await api.respond({
                playerSlot: `player-${index}`,
                promptId: Number(opening.promptId),
                action: { type: "mulligan", output: { type: "mulliganDecision", keep: true } },
              });
            }
            events.emit("server:room_update", { room: { host: "Seat 0" } });
            await api.work;
            if (!api.isHost || api.hostPlayerSlot !== "player-1")
              throw new Error("A bot was accepted as host");
            const snapshot = {
              type: "sync",
              config: api.config,
              from: 0,
              entries: [...api.entries],
            };
            const engine = api.game;
            events.emit("server:room_update", { room: { host: "Seat 2" } });
            await api.work;
            if (api.isHost || api.game !== engine)
              throw new Error("Former human host did not retain its replicated engine");
            await api.applySync(snapshot);
            if (api.game === engine) throw new Error("Transcript restart retained the old worker");
            if (api.needsSync || api.entries.length !== snapshot.entries.length)
              throw new Error(
                `Transcript replay diverged at ${api.entries.length}/${snapshot.entries.length}`,
              );
            events.emit("server:room_update", { room: { host: "Seat 1" } });
            await api.work;
            if (!api.isHost) throw new Error("Human seat did not take over");
          }
          if (scenario.bots.length === 0) {
            if (prompt?.input.type !== "mulligan")
              throw new Error("Human seat did not receive its mulligan");
            return;
          }
          for (let decision = 0; decision < 600; decision++) {
            if (
              Object.values(seats).every((seat) => seat.land && seat.creature) &&
              combat &&
              damage
            )
              return;
            if (errors.length) throw new Error(JSON.stringify(errors));
            const rejected = api.entries.find((entry) => entry.rejected);
            if (rejected) throw new Error(`Rejected input: ${JSON.stringify(rejected)}`);
            if (view?.gameOver)
              throw new Error(
                `Game ended before bots played and attacked: ${JSON.stringify({ scenario: scenario.name, turn: view.turn, seats, combat, damage, players: view.players })}`,
              );
            const current =
              prompt ??
              (scenario.name === "takeover" ? (await api.readManabrewView(2)).prompt : null);
            if (!current)
              throw new Error(`Human prompt missing in ${scenario.name} at turn ${view?.turn}`);
            prompt = null;
            const input = current.input;
            let output;
            switch (input.type) {
              case "mulligan":
                output = { type: "mulliganDecision", keep: true };
                break;
              case "chooseAction":
                output = { type: "pass", exhaustStack: false };
                break;
              case "chooseAttackers":
                output = { type: "declareAttackers", assignments: [] };
                break;
              case "chooseBlockers":
                output = { type: "declareBlockers", assignments: [] };
                break;
              case "chooseCards":
                output = {
                  type: "chooseCardsDecision",
                  chosenCardIds: input.cards.slice(0, input.min).map((card) => card.id),
                };
                break;
              case "chooseFromSelection":
                output = {
                  type: "selectionDecision",
                  chosenIndices: Array.from({ length: input.minTotal }, (_, index) => index),
                };
                break;
              case "revealCards":
                output = { type: "revealCardsAcknowledged" };
                break;
              default:
                throw new Error(`Unexpected human prompt: ${input.type}`);
            }
            await api.respond({
              playerSlot: current.decidingPlayerId,
              promptId: Number(current.promptId),
              action: { type: input.type, output },
            });
          }
          throw new Error(
            `Bots did not play and attack: ${JSON.stringify({ turn: view?.turn, seats, combat, damage })}`,
          );
        };
        await Promise.race([
          play(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    `${scenario.name} timed out: ${JSON.stringify({ turn: view?.turn, step: view?.step, seats, combat, damage, entries: api.entries.length, last: api.entries.at(-1) })}`,
                  ),
                ),
              45000,
            );
          }),
        ]);
        results.push({ scenario: scenario.name, turn: view?.turn, seats, combat, damage, errors });
      } finally {
        clearTimeout(timer);
        const pendingView = api.game
          ? api.readManabrewView(scenario.local).then(
              () => "resolved",
              (error) => error.name,
            )
          : null;
        await api.endGame();
        if (pendingView && (await pendingView) !== "AbortError")
          throw new Error("Game teardown did not cancel the pending worker request");
        if ((await api.getPrompt()) !== null) throw new Error("Game teardown retained a prompt");
        unsubscribe.forEach((stop) => stop());
      }
    }
    crypto.getRandomValues = randomValues;
    return results;
  });
  for (const result of results) {
    assert.deepEqual(result.errors, []);
    console.log(`PASS: Ironsmith Manabot ${JSON.stringify(result)}`);
  }
  assert.ok(workersCreated >= 5, "Each game and transcript restart must own an engine worker");
  let closeTimer;
  try {
    await Promise.race([
      Promise.all(workerClosures),
      new Promise((_, reject) => {
        closeTimer = setTimeout(() => reject(new Error("Engine worker did not terminate")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(closeTimer);
  }
  assert.equal(liveWorkers.size, 0, "Game teardown must terminate every engine worker");
} catch (error) {
  console.error("FAIL:", error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
