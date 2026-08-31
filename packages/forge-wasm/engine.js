import initAssetBuilder, { forge_asset_bundle } from "./forge-assets.js";
import { deckCardNames } from "./deckCards.js";
import { createSeat, deliverSeatDirective, pollSeat, writeSeatMessage } from "./seat.js";

const LOCAL_SEAT = "local";

let assetBuilderPromise;

/**
 * The engine, less the four things a runtime decides: where its files are, how
 * a worker starts, how bytes are read, and whether the runtime can host it at
 * all. `forge.js` binds the browser to it, `node.js` binds Node.
 */
export class ForgeEngine {
  constructor(platform, options = {}) {
    this.platform = platform;
    this.options = options;
    this.locations = platform.locations(options);
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
      const unsupported = this.platform.unsupported();
      if (unsupported) {
        reject(new Error(unsupported));
        return;
      }
      this.worker = this.platform.spawnWorker(this.locations.worker);
      this.worker.onError((error) => reject(error));
      this.worker.onMessage((message) => {
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
      });
    });
    return this.ready;
  }

  async buildAssets(decks) {
    if (typeof this.options.assets === "string") return this.options.assets;
    if (typeof this.options.assets === "function") return this.options.assets(decks);
    if (!assetBuilderPromise) {
      assetBuilderPromise = this.platform
        .assetModule(this.locations.assetWasm)
        .then((module_or_path) => initAssetBuilder({ module_or_path }));
    }
    await assetBuilderPromise;
    if (!this.cardsetBytes) {
      this.cardsetBytes = await this.platform.readCardset(this.locations.cardset);
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
      forgeLauncherUrl: this.locations.launcher,
      forgeWasmUrl: this.locations.wasm,
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

  /** Delivered at once if the engine is blocked there, otherwise at that
   *  seat's next prompt. A concession between prompts is not dropped. */
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
