/**
 * Web Worker for running the wasm game engine.
 *
 * Uses SharedArrayBuffer + Atomics for blocking human player input.
 * The game loop runs synchronously in the worker, blocking on Atomics.wait()
 * when the human player needs to make a decision.
 */

import init, {
  wasm_init,
  echo,
  test_rng,
  test_foundation,
  load_card_archive,
  has_card,
  run_interactive_game,
  run_multiplayer_game,
  limited_list_sealed_templates,
  limited_list_chaos_themes,
  limited_list_conspiracy_hooks,
  limited_start_sealed,
  limited_get_sealed_pool,
  limited_get_edition_info,
  limited_get_set_pool,
  limited_start_booster_draft,
  limited_start_multiplayer_draft,
  limited_pick_card,
  limited_submit_pick,
  limited_get_seat_state,
  limited_undo_pick,
  limited_get_draft_state,
  limited_start_winston,
  limited_winston_take,
  limited_winston_pass,
  limited_get_winston_state,
  limited_start_gauntlet_from_sealed,
  limited_record_gauntlet_outcome,
  limited_advance_gauntlet_round,
  limited_get_gauntlet_state,
  limited_get_gauntlet_match_decks,
  limited_update_gauntlet_human_deck,
  limited_cubecobra_url,
  limited_import_cube,
  limited_drop_session,
} from "../wasm/wasm";
import type { Deck } from "@/protocol/deck";

// ============================================================================
// Types
// ============================================================================

interface WorkerCommand {
  type: "command";
  requestId: string;
  command: string;
  args?: Record<string, unknown>;
}

interface WorkerResponse {
  type: "response";
  requestId: string;
  payload?: unknown;
  error?: string;
}

interface WorkerEvent {
  type: "event";
  event: string;
  payload: unknown;
}

// ============================================================================
// State
// ============================================================================

/** 256KB SharedArrayBuffer for prompt/response communication */
const SAB_SIZE = 256 * 1024;

let wasmInitPromise: Promise<void> | null = null;
let cardDataPromise: Promise<void> | null = null;
let cardsLoaded = false;
let gameSharedBuffer: SharedArrayBuffer | null = null;
let remoteSharedBuffers: SharedArrayBuffer[] = [];
let gameRunning = false;

/**
 */
const CARD_ARCHIVE_MANIFEST_URL = "/wasm/cardset.manifest.json";
const CARD_ARCHIVE_CACHE = "manabrew-card-archive";
const LEGACY_CARD_ARCHIVE_CACHES = ["manabrew-card-archive-v4"];

// Matching in, not filtering out: `getPlatform().invoke` on web routes every
// command to this worker, including Tauri-only ones that only reach the
// unknown-command throw, and none of those may trigger a 29 MB download.
// `start_game` / `start_multiplayer_game` ensure the archive themselves.
function needsCardData(command: string): boolean {
  return command.startsWith("limited_");
}

interface CardArchiveManifest {
  archive: string;
  sha256: string;
  bytes: number;
}

async function purgeLegacyArchiveCaches(): Promise<void> {
  for (const name of LEGACY_CARD_ARCHIVE_CACHES) {
    await caches.delete(name).catch(() => {});
  }
}

// ============================================================================
// WASM and Data Initialization
// ============================================================================

async function initWasm(): Promise<void> {
  // Cache the promise so eager init + first command share a single run.
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      console.log("[GameWorker] initWasm: calling init()");
      await init();
      console.log("[GameWorker] initWasm: init() resolved, calling wasm_init()");
      wasm_init();
      console.log("[GameWorker] initWasm: wasm_init() returned");
      postEvent("worker:init", { stage: "ready" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[GameWorker] Failed to initialize WASM:", error);
      // Clear the cached promise so a retry-via-reload starts fresh; the
      // worker is unrecoverable at this point but a parent reload re-spawns
      // the worker module and the cycle starts over.
      wasmInitPromise = null;
      postEvent("worker:init", { stage: "error", message });
      throw error;
    }
  })();
  return wasmInitPromise;
}

async function ensureCardData(): Promise<void> {
  if (cardsLoaded) return;
  if (cardDataPromise) return cardDataPromise;

  cardDataPromise = (async () => {
    await purgeLegacyArchiveCaches();
    try {
      await loadCardDataOnce({ reload: false });
    } catch (firstErr) {
      // Two stale-state failures share this path: a Cache API entry left over
      // from a format bump, and an HTTP-cached manifest still naming an
      // archive the current build has pruned. Clear the first and bypass the
      // second before giving up.
      console.warn(
        "[GameWorker] First archive load failed, clearing caches and retrying once:",
        firstErr,
      );
      await caches.delete(CARD_ARCHIVE_CACHE).catch(() => {
        /* delete is best-effort */
      });
      await loadCardDataOnce({ reload: true });
    }
  })();

  try {
    await cardDataPromise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[GameWorker] Card archive load failed:", error);
    postEvent("engine:cards", { stage: "error", message });
    cardDataPromise = null;
    throw error;
  }
}

/**
 * One attempt at the card-database load. Hoisted out of `ensureCardData` so
 * the auto-retry path can call it twice without duplicating the body.
 *
 * `reload` bypasses the HTTP cache for the manifest, which is the only way to
 * recover a client whose cached manifest names a pruned archive.
 */
async function loadCardDataOnce({ reload }: { reload: boolean }): Promise<void> {
  const archiveBytes = await fetchCardArchive(reload);
  console.log(
    `[GameWorker] Fetched card archive (${(archiveBytes.byteLength / 1024 / 1024).toFixed(2)} MiB)`,
  );

  postEvent("engine:cards", { stage: "parsing" });
  // load_card_archive packs (cards << 32 | tokens) into a single u64; on the
  // JS side wasm-bindgen surfaces u64 as bigint.
  const counts = load_card_archive(new Uint8Array(archiveBytes)) as unknown as bigint;
  const cardCount = Number(counts >> 32n);
  const tokenCount = Number(counts & 0xffffffffn);
  console.log(`[GameWorker] Loaded ${cardCount} cards + ${tokenCount} tokens into database`);

  cardsLoaded = true;
  postEvent("engine:cards", { stage: "ready" });
}

/**
 * Fetch the rkyv archive with a Cache API hit-then-network strategy.
 *
 * On cache hit the archive comes straight from disk — no network at all. On
 * cache miss we stream the response so the main thread can drive a progress
 * bar; after the full body is in memory we synthesize a fresh Response and
 * store it in the Cache API, so the next session is a cache hit too.
 *
 * Each stage of the load emits an `engine:cards` event so the caller can show
 * a spinner for cached/parsing and a progress bar for downloading.
 */
async function fetchCardArchive(reload: boolean): Promise<ArrayBuffer> {
  // The query param is the load-bearing part of the reload path: a cache that
  // ignores `no-cache` (or honours the `immutable` an older deployment served)
  // still has to miss on a URL it has never seen.
  const manifestUrl = reload
    ? `${CARD_ARCHIVE_MANIFEST_URL}?reload=${Date.now()}`
    : CARD_ARCHIVE_MANIFEST_URL;
  const manifestResp = await fetch(manifestUrl, { cache: reload ? "reload" : "no-cache" });
  if (!manifestResp.ok) {
    throw new Error(`Failed to fetch card archive manifest: ${manifestResp.status}`);
  }
  const manifest = (await manifestResp.json()) as CardArchiveManifest;
  const archiveUrl = `/wasm/${manifest.archive}`;

  const cache = await caches.open(CARD_ARCHIVE_CACHE);
  for (const req of await cache.keys()) {
    if (req.url !== new Request(archiveUrl).url) {
      await cache.delete(req).catch(() => {});
    }
  }

  const cached = await cache.match(archiveUrl);
  if (cached) {
    postEvent("engine:cards", { stage: "cached" });
    return cached.arrayBuffer();
  }

  const response = await fetch(archiveUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch card archive: ${response.status}`);
  }
  const total = Number(response.headers.get("content-length")) || 0;
  postEvent("engine:cards", { stage: "downloading", loaded: 0, total });

  // Stream the body so we can report progress. Falls back to a plain
  // arrayBuffer() read when no reader is available (e.g. opaque responses).
  if (!response.body) {
    const buf = await response.arrayBuffer();
    await cache.put(
      archiveUrl,
      new Response(buf, { headers: { "Content-Type": "application/octet-stream" } }),
    );
    return buf;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastReport = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      // Throttle progress events — one per ~256 KB is plenty for a 27 MB blob.
      if (received - lastReport > 256 * 1024 || received === total) {
        postEvent("engine:cards", { stage: "downloading", loaded: received, total });
        lastReport = received;
      }
    }
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  await cache.put(
    archiveUrl,
    new Response(bytes, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(received),
      },
    }),
  );
  return bytes.buffer;
}

// ============================================================================
// Interactive Game Runner
// ============================================================================

/**
 * Start an interactive game. Sends the response to the main thread BEFORE
 * blocking on run_interactive_game(), so the UI can transition to the game view.
 */
function runInteractiveGame(requestId: string, args?: Record<string, unknown>): void {
  if (gameRunning) {
    postError(requestId, "Game already active. End current game first.");
    return;
  }

  const humanDeck = args?.deck as Deck | undefined;
  const requestedAiDecks = args?.opponentDecks as Deck[] | undefined;
  const aiDecks = requestedAiDecks?.length ? requestedAiDecks : humanDeck ? [humanDeck] : [];
  if (!humanDeck || aiDecks.length === 0) {
    postError(requestId, "start_game requires a deck and opponent deck");
    return;
  }
  const config = {
    starting_life: (args?.startingLife as number) || 20,
    commander_name: args?.commanderName as string | undefined,
  };

  console.log(
    "[GameWorker] Starting interactive game:",
    humanDeck.cards.length,
    "vs",
    aiDecks.map((deck) => deck.cards.length).join("/"),
  );

  // Allocate SharedArrayBuffer for prompt/response communication
  gameSharedBuffer = new SharedArrayBuffer(SAB_SIZE);
  gameRunning = true;

  // Send SAB to main thread so it can poll for prompts and write responses
  postEvent("game:sab", { buffer: gameSharedBuffer });

  // Send response BEFORE blocking — this lets the UI transition to game view
  postResponse(requestId, "game-started");

  // Run the game — this BLOCKS the worker thread!
  try {
    const result = run_interactive_game(humanDeck, aiDecks, config, gameSharedBuffer);

    console.log("[GameWorker] Game completed:", result);
    gameRunning = false;
  } catch (e) {
    gameRunning = false;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GameWorker] Game error:", msg);
    postEvent("game:forced_end", {
      reason: "worker_error",
      message: msg,
    });
  }
}

/**
 * Start a multiplayer game as host. Two SABs: one for local player, one for
 * remote player. Main thread routes remote SAB prompts via WebSocket.
 */
function runMultiplayerHostGame(requestId: string, args?: Record<string, unknown>): void {
  if (gameRunning) {
    postError(requestId, "Game already active.");
    return;
  }

  const decks = (args?.decks as Deck[]) || [];
  const commanderNames = (args?.commanderNames as (string | null)[]) ?? decks.map(() => null);
  const playerNames = (args?.playerNames as string[]) ?? decks.map((_, i) => `player-${i}`);
  const localPlayerIndex = (args?.enginePlayerIndex as number) ?? 0;
  const startingLife = (args?.startingLife as number) || 20;

  if (decks.length < 2) {
    postError(requestId, "start_multiplayer_game requires at least two decks");
    return;
  }
  if (commanderNames.length !== decks.length) {
    postError(requestId, "commanderNames length must match decks length");
    return;
  }
  if (playerNames.length !== decks.length) {
    postError(requestId, "playerNames length must match decks length");
    return;
  }
  if (localPlayerIndex < 0 || localPlayerIndex >= decks.length) {
    postError(requestId, "enginePlayerIndex out of range");
    return;
  }
  const config = { starting_life: startingLife };

  console.log(
    "[GameWorker] Starting multiplayer game as host:",
    decks.length,
    "players, local=player-" + localPlayerIndex,
  );

  // One SAB for the local seat, one per remote seat (tagged by slot).
  gameSharedBuffer = new SharedArrayBuffer(SAB_SIZE);
  remoteSharedBuffers = [];
  postEvent("game:sab", { buffer: gameSharedBuffer });
  for (let i = 0; i < decks.length; i += 1) {
    if (i === localPlayerIndex) continue;
    const sab = new SharedArrayBuffer(SAB_SIZE);
    remoteSharedBuffers.push(sab);
    postEvent("game:remote_sab", { buffer: sab, playerSlot: `player-${i}` });
  }
  gameRunning = true;

  postResponse(requestId, "multiplayer-started");

  try {
    const result = run_multiplayer_game(
      decks,
      commanderNames,
      playerNames,
      config,
      gameSharedBuffer,
      remoteSharedBuffers,
      localPlayerIndex,
    );

    console.log("[GameWorker] Multiplayer game completed:", result);
    gameRunning = false;
  } catch (e) {
    gameRunning = false;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[GameWorker] Multiplayer game error:", msg);
    postEvent("game:forced_end", {
      reason: "worker_error",
      message: msg,
    });
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handleCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
  await initWasm();
  if (needsCardData(command)) await ensureCardData();

  switch (command) {
    case "ping":
      return "pong";

    case "echo":
      return echo(args?.message as string);

    case "test_rng":
      return test_rng();

    case "test_foundation":
      return test_foundation();

    case "start_game": {
      // Handled separately in onmessage — should not reach here
      throw new Error("start_game handled outside handleCommand");
    }

    case "respond": {
      // Responses are written directly to the SAB by the main thread,
      // not through worker commands. This is a no-op.
      return null;
    }

    case "end_game": {
      gameRunning = false;
      gameSharedBuffer = null;
      remoteSharedBuffers = [];
      console.log("[GameWorker] Game ending...");
      postEvent("game:ended", {});
      return null;
    }

    case "get_prompt": {
      // Prompts flow through the SAB, not through commands
      return null;
    }

    case "get_game_view": {
      return null;
    }

    case "restore_snapshot": {
      console.log("[GameWorker] Restore snapshot:", args?.checkpointId);
      return null;
    }

    case "is_card_supported": {
      // Answering this would cost the whole archive download, which a player
      // on the Forge engine never otherwise pays. `null` means "no answer",
      // and the caller leaves the card unmarked.
      if (!cardsLoaded) return null;
      const name = (args?.name as string) ?? "";
      if (!name) return false;
      if (has_card(name)) return true;
      const idx = name.indexOf(" // ");
      if (idx > 0) return has_card(name.slice(0, idx));
      return false;
    }

    case "limited_list_sealed_templates":
      return limited_list_sealed_templates();
    case "limited_list_chaos_themes":
      return limited_list_chaos_themes();
    case "limited_list_conspiracy_hooks":
      return limited_list_conspiracy_hooks();
    case "limited_start_sealed":
      return limited_start_sealed(args?.setup as object);
    case "limited_get_sealed_pool":
      return limited_get_sealed_pool(args?.sessionId as string);
    case "limited_get_edition_info":
      return limited_get_edition_info(args?.setCode as string);
    case "limited_get_set_pool":
      return limited_get_set_pool(args?.setCode as string);
    case "limited_start_booster_draft":
      return limited_start_booster_draft(args?.setup as object);
    case "limited_start_multiplayer_draft":
      return limited_start_multiplayer_draft(args?.setup as object, args?.humans as object);
    case "limited_pick_card":
      return limited_pick_card(
        args?.sessionId as string,
        args?.cardName as string,
        args?.setCode as string,
        args?.cardNumber as string,
      );
    case "limited_submit_pick":
      return limited_submit_pick(
        args?.sessionId as string,
        args?.seatIdx as number,
        args?.cardName as string,
        args?.setCode as string,
        args?.cardNumber as string,
      );
    case "limited_get_seat_state":
      return limited_get_seat_state(args?.sessionId as string, args?.seatIdx as number);
    case "limited_undo_pick":
      return limited_undo_pick(args?.sessionId as string);
    case "limited_get_draft_state":
      return limited_get_draft_state(args?.sessionId as string);
    case "limited_start_winston":
      return limited_start_winston(args?.setup as object);
    case "limited_winston_take":
      return limited_winston_take(args?.sessionId as string);
    case "limited_winston_pass":
      return limited_winston_pass(args?.sessionId as string);
    case "limited_get_winston_state":
      return limited_get_winston_state(args?.sessionId as string);
    case "limited_start_gauntlet_from_sealed":
      return limited_start_gauntlet_from_sealed(
        args?.sessionId as string,
        args?.rounds as number,
        args?.main as object,
        args?.sideboard as object,
      );
    case "limited_record_gauntlet_outcome":
      return limited_record_gauntlet_outcome(
        args?.gauntletId as string,
        args?.wonGame as boolean,
        args?.matchOver as boolean,
        args?.matchWon as boolean,
      );
    case "limited_advance_gauntlet_round":
      return limited_advance_gauntlet_round(args?.gauntletId as string);
    case "limited_get_gauntlet_state":
      return limited_get_gauntlet_state(args?.gauntletId as string);
    case "limited_get_gauntlet_match_decks":
      return limited_get_gauntlet_match_decks(args?.gauntletId as string);
    case "limited_update_gauntlet_human_deck":
      return limited_update_gauntlet_human_deck({
        gauntletId: args?.gauntletId,
        main: args?.main,
        sideboard: args?.sideboard,
      });
    case "limited_cubecobra_url":
      return limited_cubecobra_url(args?.cubeIdOrUrl as string);
    case "limited_import_cube":
      return limited_import_cube(args?.request as object, args?.body as string);
    case "limited_drop_session":
      return limited_drop_session(args?.kind as string, args?.sessionId as string);

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ============================================================================
// Message Handling
// ============================================================================

function postResponse(requestId: string, payload?: unknown): void {
  const message: WorkerResponse = {
    type: "response",
    requestId,
    payload,
  };
  self.postMessage(message);
}

function postError(requestId: string, error: string): void {
  const message: WorkerResponse = {
    type: "response",
    requestId,
    error,
  };
  self.postMessage(message);
}

function postEvent(event: string, payload: unknown): void {
  const message: WorkerEvent = {
    type: "event",
    event,
    payload,
  };
  self.postMessage(message);
}

// Boot the wasm module as soon as the worker loads so the first command does
// not pay for it. The card archive is NOT loaded here: it is a 29 MB download
// that only the Manabrew engine needs, and most games run on Forge.
// `initWasm` is idempotent; the eventual `handleCommand` call below awaits
// the same promise.
void initWasm().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[GameWorker] Eager init failed:", message);
});

self.onmessage = async (e: MessageEvent<WorkerCommand>) => {
  const { type, requestId, command, args } = e.data;

  if (type !== "command") {
    console.warn("[GameWorker] Unknown message type:", type);
    return;
  }

  // These commands block the worker thread — send response before blocking
  if (command === "start_game") {
    try {
      await initWasm();
      await ensureCardData();
      runInteractiveGame(requestId, args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[GameWorker] start_game error:", msg);
      postError(requestId, msg);
    }
    return;
  }

  if (command === "start_multiplayer_game") {
    try {
      await initWasm();
      await ensureCardData();
      runMultiplayerHostGame(requestId, args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("[GameWorker] start_multiplayer_game error:", msg);
      postError(requestId, msg);
    }
    return;
  }

  try {
    const result = await handleCommand(command, args);
    postResponse(requestId, result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GameWorker] Command error:", command, errorMessage);
    postError(requestId, errorMessage);
  }
};

console.log("[GameWorker] Worker script loaded");
