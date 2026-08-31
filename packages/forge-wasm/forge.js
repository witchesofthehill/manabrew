import initAssetBuilder, { forge_asset_bundle } from "./forge-assets.js";
import workerUrl from "./forge-engine.worker.js?url";
import launcherUrl from "./forgeharness.js?url";
import wasmUrl from "./forgeharness.js.wasm?url";
import cardsetUrl from "./cardset.rkyv?url";
import assetWasmUrl from "./forge-assets_bg.wasm?url";
import { deckCardNames } from "./deckCards.js";
import { createSeat, deliverSeatDirective, pollSeat, writeSeatMessage } from "./seat.js";

/** The main thread's own name for the seat this browser plays. */
const LOCAL_SEAT = "local";

let assetBuilderPromise;

function asUrl(value, fallback) {
  if (value instanceof URL) return value;
  return new URL(value || fallback, globalThis.location?.href || import.meta.url);
}

export class ForgeEngine {
  constructor(options = {}) {
    this.options = options;
    this.workerUrl = asUrl(options.workerUrl, workerUrl);
    this.launcherUrl = asUrl(options.launcherUrl, launcherUrl);
    this.wasmUrl = asUrl(options.wasmUrl, wasmUrl);
    this.cardsetUrl = asUrl(options.cardsetUrl, cardsetUrl);
    this.assetWasmUrl = asUrl(options.assetWasmUrl, assetWasmUrl);
    this.worker = null;
    this.ready = null;
    this.requestId = 0;
    this.pending = new Map();
    this.seats = new Map();
    this.cardsetBytes = null;
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
        reject(
          new Error("Forge requires a cross-origin isolated page with SharedArrayBuffer enabled."),
        );
        return;
      }
      this.worker = new Worker(this.workerUrl);
      this.worker.onerror = (event) => reject(event.error || new Error(event.message));
      this.worker.onmessage = (event) => {
        const message = event.data;
        if (message?.type === "response") {
          const pending = this.pending.get(message.requestId);
          if (!pending) return;
          this.pending.delete(message.requestId);
          if (message.error) pending.reject(new Error(String(message.error)));
          else pending.resolve(message.payload);
          return;
        }
        if (message?.type !== "event") return;
        if (message.event === "worker:init" && message.payload?.stage === "ready") resolve();
        if (message.event === "game:sab") this.attachSeat(LOCAL_SEAT, message.payload.buffer);
        if (message.event === "game:remote_sab") {
          this.attachSeat(message.payload.playerSlot, message.payload.buffer);
        }
        this.options.onEvent?.(message.event, message.payload);
      };
    });
    return this.ready;
  }

  async buildAssets(decks) {
    if (typeof this.options.assets === "string") return this.options.assets;
    if (typeof this.options.assets === "function") return this.options.assets(decks);
    if (!assetBuilderPromise) {
      assetBuilderPromise = initAssetBuilder({ module_or_path: this.assetWasmUrl });
    }
    await assetBuilderPromise;
    if (!this.cardsetBytes) {
      const response = await fetch(this.cardsetUrl);
      if (!response.ok) throw new Error(`Failed to fetch Forge cardset: HTTP ${response.status}`);
      this.cardsetBytes = new Uint8Array(await response.arrayBuffer());
    }
    return forge_asset_bundle(this.cardsetBytes, deckCardNames(decks));
  }

  async startGame(args) {
    await this.init();
    const decks = [args.deck, ...(args.opponentDecks?.length ? args.opponentDecks : [args.deck])];
    const forgeAssets = args.forgeAssets || (await this.buildAssets(decks));
    return this.command("start_game", this.runtimeArgs(args, forgeAssets));
  }

  async startMultiplayerGame(args) {
    await this.init();
    const forgeAssets = args.forgeAssets || (await this.buildAssets(args.decks));
    return this.command("start_multiplayer_game", this.runtimeArgs(args, forgeAssets));
  }

  runtimeArgs(args, forgeAssets) {
    return {
      ...args,
      forgeAssets,
      forgeLauncherUrl: this.launcherUrl.href,
      forgeWasmUrl: this.wasmUrl.href,
    };
  }

  command(command, args) {
    if (!this.worker) return Promise.reject(new Error("Forge worker is not initialised."));
    const requestId = String(++this.requestId);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ type: "command", command, requestId, args });
    });
  }

  attachSeat(playerSlot, buffer) {
    const seat = createSeat(buffer);
    const previous = this.seats.get(playerSlot);
    if (previous) previous.cancelled = true;
    this.seats.set(playerSlot, seat);
    pollSeat(
      seat,
      (message) => this.dispatchMessage(message, playerSlot),
      (error) => this.options.onError?.(error),
    );
  }

  dispatchMessage(message, seatSlot) {
    const playerSlot = seatSlot === LOCAL_SEAT ? undefined : seatSlot;
    this.options.onMessage?.(message, playerSlot);
    if (message?.kind === "state") this.options.onState?.(message.state, playerSlot);
    if (message?.kind === "prompt") this.options.onPrompt?.(message.prompt, playerSlot);
    if (message?.kind === "display") this.options.onDisplay?.(message.event, playerSlot);
    if (message?.kind === "error") this.options.onError?.(message.error, playerSlot);
  }

  respond(promptId, action, playerSlot = LOCAL_SEAT) {
    const seat = this.seat(playerSlot);
    if (!seat.awaitingResponse) throw new Error(`Forge seat ${playerSlot} is not awaiting input.`);
    writeSeatMessage(seat, { kind: "response", promptId, action });
  }

  /**
   * Queue a directive for the seat. It reaches the engine at once when the
   * engine is already blocked there, and otherwise at that seat's next prompt,
   * so a concession raised between prompts is not dropped.
   */
  directive(directive, playerSlot = LOCAL_SEAT) {
    deliverSeatDirective(this.seat(playerSlot), directive);
  }

  seat(playerSlot) {
    const seat = this.seats.get(playerSlot);
    if (!seat) throw new Error(`Forge seat ${playerSlot} is not available.`);
    return seat;
  }

  dispose() {
    for (const seat of this.seats.values()) seat.cancelled = true;
    this.seats.clear();
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values())
      pending.reject(new Error("Forge engine disposed."));
    this.pending.clear();
  }
}

export async function createForgeEngine(options = {}) {
  const engine = new ForgeEngine(options);
  await engine.init();
  return engine;
}

/** The published version, written in from package.json when the package is
 *  built. A checkout that has not been through that build reads as dev. */
export const VERSION = "0.0.0-dev";

/**
 * The `forge-cardset-archive` release whose card-script selector is compiled
 * into this package. `cargo add forge-cardset-archive@<this>` gets the same
 * selection rules on the Rust side.
 *
 * It is the last *released* version, so a package built between releases
 * carries source the crate has not shipped yet. BUILD_COMMIT is what names
 * the exact tree, and is what a bug report should quote.
 */
export const CARDSET_ARCHIVE_VERSION = "0.0.0-dev";

/** The manabrew commit this package was built from. */
export const BUILD_COMMIT = "unknown";
