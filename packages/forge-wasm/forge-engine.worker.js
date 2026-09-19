const SAB_SIZE = 256 * 1024;
let launcherUrl = null;
let wasmUrl = null;

let booting = null;
let gameRunning = false;

const postEvent = (event, payload) => self.postMessage({ type: "event", event, payload });

for (const level of ["log", "warn", "error"]) {
  console[level] = (...args) => {
    try {
      postEvent("forge:log", { level, text: args.join(" ") });
    } catch {
      /* ignore */
    }
  };
}
const postResponse = (requestId, payload) =>
  self.postMessage({ type: "response", requestId, payload });
const postError = (requestId, error) => self.postMessage({ type: "response", requestId, error });

function boot() {
  if (booting) return booting;
  booting = new Promise((resolve, reject) => {
    // The launcher reads argv from scriptArgs in non-node runtimes, and derives
    // the wasm URL from this worker's own filename.
    self.scriptArgs = ["--serve"];
    self.__forgeBootResolve = resolve;
    self.__forgeWasmUrl = wasmUrl;
    try {
      importScripts(launcherUrl);
    } catch (e) {
      self.__forgeBootResolve = null;
      reject(e);
    }
  });
  return booting;
}

/**
 * Deck.cards is already one entry per copy, and the printing lives under
 * identity. Older shapes carried a bare name plus a count, so accept both.
 */
function flatten(deck) {
  const out = [];
  const cards = [...((deck && deck.cards) || []), ...((deck && deck.commanders) || [])];
  for (const card of cards) {
    const identity = card.identity || card;
    const name = identity.name;
    if (!name) continue;
    const entry = { name: frontFace(name) };
    if (identity.setCode) entry.setCode = identity.setCode;
    if (identity.cardNumber) entry.collectorNumber = identity.cardNumber;
    for (let i = 0; i < (card.count ?? 1); i++) out.push(entry);
  }
  return out;
}

/** Forge knows a double-faced card by its front face, the way the node sends it. */
function frontFace(name) {
  const cut = String(name).indexOf(" // ");
  return cut < 0 ? String(name) : String(name).slice(0, cut);
}

function forgeVariant(deck) {
  const format = String((deck && deck.format) || "").toLowerCase();
  if (format === "commander") return "Commander";
  if (format.includes("brawl")) return "Brawl";
  if (format === "oathbreaker") return "Oathbreaker";
  return "Constructed";
}

function commanderNames(deck, fallback) {
  const names = ((deck && deck.commanders) || [])
    .map((card) => frontFace((card.identity || card).name || ""))
    .filter(Boolean);
  if (names.length) return names;
  const single = fallback ? frontFace(fallback) : "";
  return single ? [single] : [];
}

/**
 * The clock unless the caller pins one. A pinned seed makes a bench rerun start
 * from the same shuffle; it does not make the game replay, because the AI's
 * timeouts and the host's scheduling still vary.
 */
function gameSeed(args) {
  const seed = args && Number(args.seed);
  return Number.isInteger(seed) && seed > 0 ? seed % 2147483647 : Date.now() % 2147483647;
}

async function startGame(requestId, args) {
  if (gameRunning) return postError(requestId, "Game already active.");

  launcherUrl = (args && args.forgeLauncherUrl) || launcherUrl;
  wasmUrl = (args && args.forgeWasmUrl) || wasmUrl;
  const humanDeck = args && args.deck;
  const requested = args && args.opponentDecks;
  const aiDecks = requested && requested.length ? requested : humanDeck ? [humanDeck] : [];
  if (!humanDeck || !aiDecks.length) {
    return postError(requestId, "start_game requires a deck and opponent deck");
  }

  try {
    await boot();
  } catch (e) {
    return postError(requestId, `forge engine failed to load: ${e && e.message ? e.message : e}`);
  }

  const seatBuffers = [humanDeck, ...aiDecks].map(() => new SharedArrayBuffer(SAB_SIZE));
  self.__forgeSeatSabs = seatBuffers;
  self.__forgeSab = seatBuffers[0];
  gameRunning = true;

  postEvent("game:sab", { buffer: seatBuffers[0] });
  seatBuffers.slice(1).forEach((buffer, index) => {
    postEvent("game:remote_sab", { buffer, playerSlot: `player-${index + 1}` });
  });
  postResponse(requestId, "game-started");

  const variant = forgeVariant(humanDeck);
  const commanderGame = variant !== "Constructed";
  const request = {
    gameId: `forge-${Date.now()}`,
    variant,
    startingLife: (args && args.startingLife) || (commanderGame ? 40 : 20),
    seed: gameSeed(args),
    players: [
      {
        name: "You",
        ai: false,
        deck: flatten(humanDeck),
        commanderNames: commanderGame ? commanderNames(humanDeck, args && args.commanderName) : [],
      },
      ...aiDecks.map((deck, i) => ({
        name: i > 0 ? `Manabot ${i + 1}` : "Manabot",
        ai: false,
        // A bot reads the board only when prompted, so the engine describes
        // it to this seat only then.
        bot: true,
        deck: flatten(deck),
        commanderNames: commanderGame ? commanderNames(deck, null) : [],
      })),
    ],
  };
  console.log(`[wasm] starting a ${variant} game at ${request.startingLife} life`);

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

async function startMultiplayerGame(requestId, args) {
  if (gameRunning) return postError(requestId, "Game already active.");

  launcherUrl = (args && args.forgeLauncherUrl) || launcherUrl;
  wasmUrl = (args && args.forgeWasmUrl) || wasmUrl;
  const decks = (args && args.decks) || [];
  const playerNames = (args && args.playerNames) || [];
  const commanders = (args && args.commanderNames) || [];
  const localPlayerIndex = (args && args.enginePlayerIndex) | 0;
  const forgeAiSeats = new Set((args && args.forgeAiSeats) || []);
  if (decks.length < 2) {
    return postError(requestId, "start_multiplayer_game requires at least two decks");
  }
  if (playerNames.length !== decks.length) {
    return postError(requestId, "playerNames length must match decks length");
  }
  if (localPlayerIndex < 0 || localPlayerIndex >= decks.length) {
    return postError(requestId, "enginePlayerIndex out of range");
  }

  try {
    await boot();
  } catch (e) {
    return postError(requestId, `forge engine failed to load: ${e && e.message ? e.message : e}`);
  }

  // Indexed by the engine's own player index, which is what the session hands
  // the bridge when it publishes a prompt.
  const seatBuffers = decks.map(() => new SharedArrayBuffer(SAB_SIZE));
  self.__forgeSeatSabs = seatBuffers;
  self.__forgeSab = seatBuffers[localPlayerIndex];
  gameRunning = true;

  postEvent("game:sab", { buffer: seatBuffers[localPlayerIndex] });
  seatBuffers.forEach((buffer, index) => {
    if (index === localPlayerIndex) return;
    postEvent("game:remote_sab", { buffer, playerSlot: `player-${index}` });
  });
  postResponse(requestId, "multiplayer-started");

  const variant = forgeVariant(decks[0]);
  const commanderGame = variant !== "Constructed";
  const request = {
    gameId: `forge-${Date.now()}`,
    variant,
    startingLife: (args && args.startingLife) || (commanderGame ? 40 : 20),
    seed: gameSeed(args),
    players: decks.map((deck, index) => ({
      name: playerNames[index] || `Player ${index + 1}`,
      ai: forgeAiSeats.has(index),
      deck: flatten(deck),
      commanderNames: commanderGame ? commanderNames(deck, commanders[index] ?? null) : [],
    })),
  };
  console.log(
    `[wasm] hosting a ${variant} table: ${decks.length} seats, local seat ${localPlayerIndex}`,
  );

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
  if (msg.command === "start_multiplayer_game") {
    return void startMultiplayerGame(msg.requestId, msg.args);
  }
  if (msg.command === "wasm_init" || msg.command === "ensure_card_data") {
    return void boot().then(
      () => postResponse(msg.requestId, "ok"),
      (err) => postError(msg.requestId, String(err)),
    );
  }
  if (msg.command === "end_game") {
    gameRunning = false;
    self.__forgeSeatSabs = null;
    return postResponse(msg.requestId, null);
  }
  if (
    msg.command === "respond" ||
    msg.command === "get_prompt" ||
    msg.command === "get_game_view"
  ) {
    return postResponse(msg.requestId, null);
  }
  postError(
    msg.requestId,
    `the Forge engine does not implement "${msg.command}" — it should have gone to the Rust worker`,
  );
};

postEvent("worker:init", { stage: "ready" });
