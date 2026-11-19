import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { launchOpts } from "./lib.mjs";

const base = process.env.BASE || "http://localhost:1420";
const count = Number(process.env.GAMES || 30);
const firstSeed = Number(process.env.SEED || 1);
const timeoutMs = Number(process.env.GAME_TIMEOUT_MS || 120000);
const maxDecisions = Number(process.env.MAX_DECISIONS || 10000);
const output = process.env.OUT || `tmp/ironsmith-stress-${Date.now()}`;
const presets = (
  process.env.DECKS ||
  "ironsmith_vintage_106774,ironsmith_standard_264531,ironsmith_standard_284980,ironsmith_standard_295360,ironsmith_standard_665906,ironsmith_standard_723954"
).split(",");
for (const value of [count, firstSeed, timeoutMs, maxDecisions]) {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Stress limits must be positive integers");
}
await mkdir(output, { recursive: true });
const enginePackage = JSON.parse(
  await readFile(new URL(import.meta.resolve("ironsmith-wasm/package.json")), "utf8"),
);
const hash = async (url) =>
  createHash("sha256")
    .update(await readFile(url))
    .digest("hex");
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      engineVersion: enginePackage.version,
      engineWasmSha256: await hash(new URL(import.meta.resolve("ironsmith-wasm/engine_bg.wasm"))),
      botWasmSha256: await hash(new URL("../../src/wasm/wasm_bg.wasm", import.meta.url)),
      firstSeed,
      count,
      presets,
      timeoutMs,
      maxDecisions,
    },
    null,
    2,
  ),
);
const browser = await chromium.launch(launchOpts());
const results = [];
try {
  const page = await browser.newPage();
  const workers = new Set();
  page.on("worker", (worker) => {
    if (!worker.url().includes("ironsmith.worker")) return;
    workers.add(worker);
    worker.once("close", () => workers.delete(worker));
  });
  await page.route("**/__ironsmith-stress", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><html><body></body></html>" }),
  );
  await page.goto(`${base}/__ironsmith-stress`);
  for (let index = 0; index < count; index++) {
    const seed = firstSeed + index;
    const players = 2 + ((seed - 1) % 3);
    const deckIds = Array.from(
      { length: players },
      (_, seat) => presets[(seed - 1 + seat) % presets.length],
    );
    const result = await page.evaluate(
      async ({ seed, players, deckIds, timeoutMs, maxDecisions }) => {
        const { IronsmithTrustedGameApi } = await import("/src/game/ironsmithRuntime.ts");
        const { expandPresetDeckDefinition } = await import("/src/lib/presetDecks.ts");
        const { getPlatform } = await import("/src/platform/index.ts");
        const { newBotRecovery, recoverBotAnswer } =
          await import("/src/game/ironsmithBotRecovery.ts");
        const recovery = newBotRecovery();
        const { PHASES } = await import("/src/components/game/game.constants.ts");
        const api = new IronsmithTrustedGameApi();
        const errors = [];
        const phases = new Set();
        let view;
        let decisions = 0;
        let timer;
        let status = "completed";
        let failure;
        let fatal = false;
        let rejectedActions = 0;
        let rejectLimit;
        const limit = new Promise((_, reject) => {
          rejectLimit = reject;
        });
        const started = performance.now();
        const randomValues = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (values) => {
          randomValues(values);
          if (values instanceof Uint32Array && values.length === 1) values[0] = seed;
          return values;
        };
        const stop = [
          getPlatform().events.on("game:state", ({ gameView }) => {
            if (view && gameView.turn < view.turn) errors.push("Turn counter went backwards");
            if (!PHASES.some(({ id }) => id === gameView.step))
              errors.push(`Unknown phase: ${gameView.step}`);
            view = gameView;
            phases.add(gameView.step);
            if (api.entries.length >= maxDecisions && !gameView.gameOver) {
              status = "capped";
              rejectLimit(new Error(`Game exceeded ${maxDecisions} decisions`));
            }
          }),
          getPlatform().events.on("game:error", (error) => errors.push(error)),
          getPlatform().events.on("game:fatal", (error) => {
            errors.push(error);
            fatal = true;
          }),
        ];
        let artifact;
        let pendingPrompts;
        try {
          const play = async () => {
            const decks = await Promise.all(
              deckIds.map(async (id) => {
                const response = await fetch(`/preset_decks/${id}.json`);
                if (!response.ok) throw new Error(`Preset ${id}: HTTP ${response.status}`);
                return expandPresetDeckDefinition({ ...(await response.json()), id });
              }),
            );
            await api.startMultiplayerGame({
              playerNames: Array.from({ length: players }, (_, seat) => `Seat ${seat}`),
              decks,
              commanderNames: decks.map((deck) => deck.commanders?.[0]?.identity.name ?? null),
              startingLife: decks.some((deck) => deck.commanders?.length) ? 40 : 20,
              format: "Vintage",
              enginePlayerIndex: 0,
              localIsHost: true,
              botPlayerSlots: Array.from(
                { length: players - 1 },
                (_, seat) => `player-${seat + 1}`,
              ),
            });
            while (!view?.gameOver) {
              if (fatal || errors.some((error) => typeof error === "string"))
                throw new Error(JSON.stringify(errors));
              const { gameView, prompt } = await api.readManabrewView(0);
              if (!prompt) {
                pendingPrompts = [];
                for (let seat = 0; seat < players; seat++) {
                  const pending = await api.readManabrewView(seat);
                  if (pending.prompt) pendingPrompts.push(pending.prompt);
                }
                const pending = pendingPrompts[0];
                throw new Error(
                  pending
                    ? `${pending.decidingPlayerId} stalled at ${pending.input.type} prompt ${pending.promptId}`
                    : `Missing local prompt at turn ${gameView.turn}, ${gameView.step}`,
                );
              }
              const recovered = recoverBotAnswer(prompt, recovery);
              if (recovered === "stalled") {
                pendingPrompts = [prompt];
                throw new Error(`Local bot stalled at prompt ${prompt.promptId}`);
              }
              const action =
                recovered ?? (await api.callEngine("botAction", "player-0", gameView, prompt));
              await api.respond({
                playerSlot: "player-0",
                promptId: Number(prompt.promptId),
                action,
              });
              decisions++;
              const rejected = api.entries.find(
                (entry) =>
                  entry.rejected &&
                  entry.slot === "player-0" &&
                  entry.promptId === Number(prompt.promptId),
              );
              if (rejected) recovery.refusedPromptId = Number(prompt.promptId);
            }
            if (fatal || errors.some((error) => typeof error === "string"))
              throw new Error(JSON.stringify(errors));
          };
          await Promise.race([
            play(),
            limit,
            new Promise((_, reject) => {
              timer = setTimeout(() => {
                status = "timeout";
                reject(new Error(`Game exceeded ${timeoutMs}ms`));
              }, timeoutMs);
            }),
          ]);
        } catch (error) {
          if (status !== "timeout" && status !== "capped") status = "failed";
          failure = error instanceof Error ? error.message : String(error);
        } finally {
          clearTimeout(timer);
          decisions = api.entries.length;
          rejectedActions = api.entries.filter((entry) => entry.rejected).length;
          if (status !== "completed")
            artifact = {
              config: api.config,
              entries: [...api.entries],
              view,
              errors,
              pendingPrompts,
            };
          await api.endGame();
          stop.forEach((unsubscribe) => unsubscribe());
          crypto.getRandomValues = randomValues;
        }
        return {
          seed,
          players,
          deckIds,
          status,
          failure,
          decisions,
          rejectedActions,
          turn: view?.turn,
          winner: view?.winnerId,
          phases: [...phases],
          elapsedMs: Math.round(performance.now() - started),
          artifact,
        };
      },
      { seed, players, deckIds, timeoutMs, maxDecisions },
    );
    const deadline = Date.now() + 5000;
    while (workers.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    if (workers.size) throw new Error(`${workers.size} engine workers survived game ${seed}`);
    const { artifact, ...summary } = result;
    results.push(summary);
    if (artifact)
      await writeFile(
        `${output}/seed-${seed}.json`,
        JSON.stringify({ ...summary, ...artifact }, null, 2),
      );
    await writeFile(`${output}/summary.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(summary));
  }
} finally {
  await browser.close();
}
const counts = results.reduce(
  (counts, result) => ({ ...counts, [result.status]: (counts[result.status] || 0) + 1 }),
  {},
);
console.log(JSON.stringify({ games: results.length, counts, output }));
if (results.some(({ status }) => status !== "completed")) process.exitCode = 1;
