import initAssetBuilder, { forge_asset_bundle } from "./forge-assets.js";
import workerUrl from "./forge-engine.worker.js?url";
import launcherUrl from "./forgeharness.js?url";
import wasmUrl from "./forgeharness.js.wasm?url";
import cardsetUrl from "./cardset.rkyv?url";
import assetWasmUrl from "./forge-assets_bg.wasm?url";

const SAB_SIZE = 256 * 1024;
let assetBuilderPromise;

function asUrl(value, fallback) {
  if (value instanceof URL) return value;
  return new URL(value || fallback, globalThis.location?.href || import.meta.url);
}

function deckCardNames(decks) {
  const names = new Set();
  for (const deck of decks) {
    const cards = [...(deck?.cards || []), ...(deck?.commanders || [])];
    for (const card of cards) {
      const name = String((card.identity || card).name || "").split(" // ")[0];
      if (name) names.add(name);
    }
  }
  return [...names];
}

function schedule(callback) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(callback, 0);
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
        if (message.event === "game:sab") this.attachSeat("local", message.payload.buffer);
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
    if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== SAB_SIZE) {
      throw new Error("Forge returned an invalid SharedArrayBuffer.");
    }
    const old = this.seats.get(playerSlot);
    if (old) old.active = false;
    const seat = {
      active: true,
      awaitingResponse: false,
      signal: new Int32Array(buffer, 0, 2),
      data: new Uint8Array(buffer, 8),
    };
    this.seats.set(playerSlot, seat);
    this.pollSeat(playerSlot, seat);
  }

  pollSeat(playerSlot, seat) {
    const poll = () => {
      if (!seat.active || this.seats.get(playerSlot) !== seat) return;
      if (Atomics.load(seat.signal, 0) === 1) {
        const length = Atomics.load(seat.signal, 1);
        const json = new TextDecoder().decode(seat.data.slice(0, length));
        Atomics.store(seat.signal, 0, 3);
        Atomics.notify(seat.signal, 0);
        try {
          const message = JSON.parse(json);
          seat.awaitingResponse = message?.kind === "prompt";
          this.dispatchMessage(message, playerSlot === "local" ? undefined : playerSlot);
        } catch (error) {
          this.options.onError?.(error);
        }
      }
      schedule(poll);
    };
    schedule(poll);
  }

  dispatchMessage(message, playerSlot) {
    this.options.onMessage?.(message, playerSlot);
    if (message?.kind === "state") this.options.onState?.(message.state, playerSlot);
    if (message?.kind === "prompt") this.options.onPrompt?.(message.prompt, playerSlot);
    if (message?.kind === "display") this.options.onDisplay?.(message.event, playerSlot);
    if (message?.kind === "error") this.options.onError?.(message.error, playerSlot);
  }

  respond(promptId, action, playerSlot = "local") {
    this.write(playerSlot, { kind: "response", promptId, action });
  }

  directive(directive, playerSlot = "local") {
    this.write(playerSlot, { kind: "directive", directive });
  }

  write(playerSlot, message) {
    const seat = this.seats.get(playerSlot);
    if (!seat) throw new Error(`Forge seat ${playerSlot} is not available.`);
    if (!seat.awaitingResponse) throw new Error(`Forge seat ${playerSlot} is not awaiting input.`);
    const bytes = new TextEncoder().encode(JSON.stringify(message));
    if (bytes.length > seat.data.length)
      throw new Error("Forge response exceeds the SAB capacity.");
    seat.awaitingResponse = false;
    Atomics.store(seat.signal, 1, bytes.length);
    seat.data.set(bytes);
    Atomics.store(seat.signal, 0, 2);
    Atomics.notify(seat.signal, 0);
  }

  dispose() {
    for (const seat of this.seats.values()) seat.active = false;
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

export const VERSION = "0.1.0";
