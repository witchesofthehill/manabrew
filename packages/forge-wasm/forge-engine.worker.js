const SAB_SIZE = 256 * 1024;
const DIRECTIVE_LANE_BYTES = 4096;
let launcherUrl = null;
let wasmUrl = null;

let booting = null;
let gameRunning = false;
let supervised = false;

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

function supervise(command) {
  supervised = true;
  let active;
  let candidate;
  let timer;
  let ended = false;
  let started = false;
  let directiveLanes;
  const stop = () => {
    ended = true;
    clearTimeout(timer);
    candidate?.worker.terminate();
    active?.worker.terminate();
    candidate = active = null;
    if (!started) postError(command.requestId, "Game ended before startup completed.");
    started = true;
  };

  const fail = (message) => {
    if (ended) return;
    candidate?.worker.terminate();
    candidate = null;
    clearTimeout(timer);
    Atomics.store(new Int32Array(active.control), 0, 1);
    Atomics.notify(new Int32Array(active.control), 0);
    postEvent("forge:log", { level: "error", text: `Rewind failed: ${message}` });
  };

  const launch = (snapshot) => {
    const control = new SharedArrayBuffer(4);
    const promptOffset = snapshot
      ? active.promptOffset + snapshot.lastPromptId + 1 - snapshot.prompt.promptId
      : 0;
    const worker = new Worker(self.location.href);
    const instance = { worker, control, buffered: [], promptOffset };
    if (snapshot) candidate = instance;
    else active = instance;
    worker.onerror = (event) => {
      if (instance === candidate) fail(event.message);
      else if (instance === active) {
        stop();
        postEvent("game:forced_end", { reason: "worker_error", message: event.message });
      }
    };
    worker.onmessage = ({ data }) => {
      if (ended || (instance !== active && instance !== candidate)) return;
      if (data.type === "event" && data.event === "worker:init") {
        worker.postMessage({
          ...command,
          args: {
            ...command.args,
            forgeLeaf: true,
            rewindControl: control,
            promptOffset,
            replaySnapshot: snapshot,
            rewindDirectiveLanes: snapshot ? directiveLanes : undefined,
          },
        });
        return;
      }
      if (data.type === "event" && data.event === "forge:rewind" && instance === active) {
        if (candidate) return;
        try {
          launch(data.payload);
          timer = setTimeout(() => fail("Replay timed out. The current game was kept."), 120000);
        } catch (error) {
          fail(String(error));
        }
        return;
      }
      if (instance === candidate) {
        if (data.error || data.event === "game:forced_end" || data.event === "game:over") {
          fail(data.error || data.payload?.message || "Replay ended before verification.");
        } else if (data.event === "forge:replay_ready") {
          clearTimeout(timer);
          active.worker.terminate();
          active = instance;
          candidate = null;
          for (const message of instance.buffered) {
            if (message.event !== "game:directive_lanes") self.postMessage(message);
          }
          instance.buffered = [];
          Atomics.store(new Int32Array(control), 0, 2);
          Atomics.notify(new Int32Array(control), 0);
        } else if (["game:sab", "game:remote_sab", "game:directive_lanes"].includes(data.event)) {
          instance.buffered.push(data);
        }
        return;
      }
      if (data.type === "response" && data.requestId === command.requestId) {
        started = true;
        if (data.error) stop();
      }
      if (data.event === "game:directive_lanes") directiveLanes = data.payload;
      if (data.event === "game:forced_end" || data.event === "game:over") stop();
      if (data.event !== "forge:journal") self.postMessage(data);
    };
    return instance;
  };

  try {
    launch(null);
  } catch (error) {
    postError(command.requestId, String(error));
    return;
  }
  self.onmessage = ({ data }) => {
    if (data?.type !== "command") return;
    if (data.command === "end_game") {
      stop();
      postResponse(data.requestId, null);
    } else if (ended) {
      postError(data.requestId, "Game has ended.");
    } else if (["respond", "get_prompt", "get_game_view"].includes(data.command)) {
      // Gameplay uses SABs. The leaf's event loop is blocked for the entire game.
      postResponse(data.requestId, null);
    } else if (["wasm_init", "ensure_card_data"].includes(data.command)) {
      postResponse(data.requestId, "ok");
    } else {
      postError(data.requestId, `Forge cannot handle ${data.command} while a game is active.`);
    }
  };
}

function runGame(request, args) {
  self.__forgeRewindControl = args.rewindControl;
  self.__forgePromptOffset = args.promptOffset ?? 0;
  if (args.replaySnapshot) {
    request = JSON.parse(args.replaySnapshot.journal.startRequest);
    request.replaySnapshot = args.replaySnapshot;
  }
  const result = self.__forgeStartGame(JSON.stringify(request));
  const error = result && JSON.parse(String(result)).error;
  if (error) throw new Error(error);
}

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

function flatten(deck) {
  return [
    ...identities((deck && deck.cards) || []),
    ...identities((deck && deck.commanders) || []).map((card) => ({ ...card, commander: true })),
  ];
}

/**
 * Deck.cards is already one entry per copy, and the printing lives under
 * identity. Older shapes carried a bare name plus a count, so accept both.
 */
function identities(cards) {
  const out = [];
  for (const card of cards) {
    const identity = card.identity || card;
    const name = identity.name;
    if (!name) continue;
    const entry = { name: frontFace(name), foil: identity.foil ?? false };
    if (identity.setCode) entry.setCode = identity.setCode;
    if (identity.cardNumber) entry.collectorNumber = identity.cardNumber;
    if (identity.cosmetics != null) entry.cosmetics = identity.cosmetics;
    if (identity.tokenScript) entry.tokenScript = identity.tokenScript;
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
  if (format === "paupercommander") return "PauperCommander";
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

function shareDirectiveLanes(seatCount, localSeat, retained) {
  const buffers =
    retained?.buffers ??
    Array.from({ length: seatCount }, () => new SharedArrayBuffer(DIRECTIVE_LANE_BYTES));
  const hostBuffer = retained?.hostBuffer ?? new SharedArrayBuffer(DIRECTIVE_LANE_BYTES);
  self.__forgeDirectiveLanes = buffers;
  self.__forgeHostLane = hostBuffer;
  postEvent("game:directive_lanes", { buffers, hostBuffer, localSeat });
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

  const forgeAi = args && args.forgeAi === true;
  const seatBuffers = (forgeAi ? [humanDeck] : [humanDeck, ...aiDecks]).map(
    () => new SharedArrayBuffer(SAB_SIZE),
  );
  self.__forgeSeatSabs = forgeAi ? null : seatBuffers;
  self.__forgeSab = seatBuffers[0];
  gameRunning = true;

  postEvent("game:sab", { buffer: seatBuffers[0] });
  seatBuffers.slice(1).forEach((buffer, index) => {
    postEvent("game:remote_sab", { buffer, playerSlot: `player-${index + 1}` });
  });
  shareDirectiveLanes(seatBuffers.length, 0, args.rewindDirectiveLanes);
  postResponse(requestId, "game-started");

  const variant = forgeVariant(humanDeck);
  const commanderGame = variant !== "Constructed";
  const request = {
    gameId: args.gameId || `forge-${Date.now()}`,
    variant,
    startingLife: (args && args.startingLife) || (commanderGame ? 40 : 20),
    seed: gameSeed(args),
    snapshotRecording: !args || args.snapshotRecording !== false,
    decisionJournal: args?.decisionJournal === true,
    journalRewind: args?.journalRewind === true,
    players: [
      {
        name: "You",
        ai: false,
        deck: flatten(humanDeck),
        sideboard: identities(humanDeck.sideboard || []),
        attractions: identities(humanDeck.attractions || []),
        tokens: identities(humanDeck.tokens || []),
        commanderNames: commanderGame ? commanderNames(humanDeck, args && args.commanderName) : [],
      },
      ...aiDecks.map((deck, i) => ({
        name: forgeAi
          ? i > 0
            ? `Forge bot ${i + 1}`
            : "Forge bot"
          : i > 0
            ? `Manabot ${i + 1}`
            : "Manabot",
        ai: forgeAi,
        // A bot reads the board only when prompted, so the engine describes
        // it to this seat only then.
        bot: !forgeAi,
        deck: flatten(deck),
        sideboard: identities(deck.sideboard || []),
        attractions: identities(deck.attractions || []),
        tokens: identities(deck.tokens || []),
        commanderNames: commanderGame ? commanderNames(deck, null) : [],
      })),
    ],
  };
  console.log(`[wasm] starting a ${variant} game at ${request.startingLife} life`);

  // Blocks the worker for the whole game, which is the point: the engine parks
  // on Atomics.wait whenever the human seat has to decide.
  try {
    runGame(request, args);
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
  const botSeats = new Set((args && args.botSeats) || []);
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
  shareDirectiveLanes(seatBuffers.length, localPlayerIndex, args.rewindDirectiveLanes);
  postResponse(requestId, "multiplayer-started");

  const variant = forgeVariant(decks[0]);
  const commanderGame = variant !== "Constructed";
  const request = {
    gameId: args.gameId || `forge-${Date.now()}`,
    variant,
    startingLife: (args && args.startingLife) || (commanderGame ? 40 : 20),
    seed: gameSeed(args),
    snapshotRecording: !args || args.snapshotRecording !== false,
    decisionJournal: args?.decisionJournal === true,
    journalRewind: args?.journalRewind === true,
    players: decks.map((deck, index) => ({
      name: playerNames[index] || `Player ${index + 1}`,
      ai: forgeAiSeats.has(index),
      bot: !forgeAiSeats.has(index) && botSeats.has(index),
      deck: flatten(deck),
      sideboard: identities(deck.sideboard || []),
      attractions: identities(deck.attractions || []),
      tokens: identities(deck.tokens || []),
      commanderNames: commanderGame ? commanderNames(deck, commanders[index] ?? null) : [],
    })),
  };
  console.log(
    `[wasm] hosting a ${variant} table: ${decks.length} seats, local seat ${localPlayerIndex}`,
  );

  try {
    runGame(request, args);
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
  if (
    !supervised &&
    !msg.args?.forgeLeaf &&
    msg.args?.journalRewind &&
    (msg.command === "start_game" || msg.command === "start_multiplayer_game")
  ) {
    supervise(msg);
    return;
  }
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
    self.__forgeDirectiveLanes = null;
    self.__forgeHostLane = null;
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
