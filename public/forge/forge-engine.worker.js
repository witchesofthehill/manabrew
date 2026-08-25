/**
 * Drop-in replacement for game-engine.worker.ts backed by the Forge rules
 * engine compiled to WebAssembly with GraalVM Web Image.
 *
 * The wire format is unchanged: the module writes {kind:"state"|"prompt"|...}
 * into the same SharedArrayBuffer and blocks on Atomics.wait, so WorkerBridge
 * and the whole game UI read it exactly as they read the Rust engine.
 *
 * Plain JS and a classic worker on purpose: the generated launcher is an IIFE
 * loaded with importScripts, which module workers forbid.
 *
 * Expects forge-harness/build-wasm.sh output plus the packed assets in
 * public/forge/ (see forge-harness/native/web/pack-assets.mjs).
 */
const SAB_SIZE = 256 * 1024;
const ENGINE_BASE = "/forge";

let booting = null;
let gameRunning = false;

const postEvent = (event, payload) => self.postMessage({ type: "event", event, payload });

// The module logs its boot progress through console; mirror it to the page so
// it is visible without opening the worker's own console.
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    try { postEvent("forge:log", { level, text: args.join(" ") }); } catch { /* ignore */ }
  };
}
const postResponse = (requestId, payload) => self.postMessage({ type: "response", requestId, payload });
const postError = (requestId, error) => self.postMessage({ type: "response", requestId, error });

function boot() {
  if (booting) return booting;
  booting = new Promise((resolve, reject) => {
    // The launcher reads argv from scriptArgs in non-node runtimes, and derives
    // the wasm URL from this worker's own filename.
    self.scriptArgs = ["--serve"];
    try {
      importScripts(`${ENGINE_BASE}/forgeharness.js`);
    } catch (e) {
      reject(e);
      return;
    }
    // serve() sets this once its exported start function is installed.
    const poll = () => (self.__forgeReady ? resolve() : setTimeout(poll, 50));
    poll();
  });
  return booting;
}

/**
 * Deck.cards is already one entry per copy, and the printing lives under
 * identity. Older shapes carried a bare name plus a count, so accept both.
 */
function flatten(deck) {
  const out = [];
  for (const card of (deck && deck.cards) || []) {
    const identity = card.identity || card;
    const name = identity.name;
    if (!name) continue;
    const entry = { name };
    if (identity.setCode) entry.setCode = identity.setCode;
    if (identity.cardNumber) entry.collectorNumber = identity.cardNumber;
    for (let i = 0; i < (card.count ?? 1); i++) out.push(entry);
  }
  return out;
}

async function startGame(requestId, args) {
  if (gameRunning) return postError(requestId, "Game already active.");

  const humanDeck = args && args.deck;
  const requested = args && args.opponentDecks;
  const aiDecks = requested && requested.length ? requested : humanDeck ? [humanDeck] : [];
  if (!humanDeck || !aiDecks.length) {
    return postError(requestId, "start_game requires a deck and opponent deck");
  }

  // Framed by the host from cardset.rkyv and handed over with the game: this
  // worker is plain JS served from public/, so it cannot resolve the bundled
  // module that reads the archive. It has to exist before boot, because the
  // engine reads its assets while importScripts runs main().
  if (!args.forgeAssets) {
    return postError(requestId, "start_game arrived without the framed Forge assets");
  }
  self.__forgeAssets = args.forgeAssets;
  console.log(`[assets] received ${(self.__forgeAssets.length / 1024) | 0} KiB from the host`);

  try {
    await boot();
  } catch (e) {
    return postError(requestId, `forge engine failed to load: ${e && e.message ? e.message : e}`);
  }

  const sab = new SharedArrayBuffer(SAB_SIZE);
  self.__forgeSab = sab;
  gameRunning = true;

  postEvent("game:sab", { buffer: sab });
  postResponse(requestId, "game-started");


  const request = {
    gameId: `forge-${Date.now()}`,
    variant: "Constructed",
    startingLife: (args && args.startingLife) || 20,
    seed: Date.now() % 2147483647,
    players: [
      { name: "You", ai: false, deck: flatten(humanDeck) },
      ...aiDecks.map((deck, i) => ({
        name: i > 0 ? `Forge AI ${i + 1}` : "Forge AI",
        ai: true,
        deck: flatten(deck),
      })),
    ],
  };

  // Blocks the worker for the whole game, which is the point: the engine parks
  // on Atomics.wait whenever the human seat has to decide.
  try {
    self.__forgeStartGame(JSON.stringify(request));
    gameRunning = false;
    postEvent("game:over", {});
  } catch (e) {
    gameRunning = false;
    postEvent("game:forced_end", {
      reason: "worker_error",
      message: e && e.message ? e.message : String(e),
    });
  }
}

self.onmessage = (e) => {
  const msg = e.data;
  if (!msg || msg.type !== "command") return;
  if (msg.command === "start_game") return void startGame(msg.requestId, msg.args);
  if (msg.command === "wasm_init" || msg.command === "ensure_card_data") {
    return void boot().then(
      () => postResponse(msg.requestId, "ok"),
      (err) => postError(msg.requestId, String(err)),
    );
  }
  // Everything else is a query the Rust worker also answers with null:
  // prompts and state flow through the SAB, not through commands.
  if (msg.command === "end_game") {
    gameRunning = false;
    return postResponse(msg.requestId, null);
  }
  postResponse(msg.requestId, null);
};

// The bridge waits for this before sending any command. Booting the module
// eagerly would cost the whole asset load up front, so report ready and let
// the first start_game pay for it.
postEvent("worker:init", { stage: "ready" });
