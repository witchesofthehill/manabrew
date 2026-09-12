import workerUrl from "./forge-engine.worker.js?url";
import launcherUrl from "./forgeharness.js?url";
import wasmUrl from "./forgeharness.js.wasm?url";
import { ForgeEngine as Engine } from "./engine.js";

function asUrl(value, fallback) {
  const base = globalThis.location?.href || import.meta.url;
  return value instanceof URL ? value.href : new URL(value || fallback, base).href;
}

const browser = {
  locations: (options) => ({
    worker: asUrl(options.workerUrl, workerUrl),
    launcher: asUrl(options.launcherUrl, launcherUrl),
    wasm: asUrl(options.wasmUrl, wasmUrl),
  }),

  unsupported: () =>
    globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== "undefined"
      ? null
      : "Forge requires a cross-origin isolated page with SharedArrayBuffer enabled.",

  spawnWorker(location) {
    const worker = new Worker(location);
    return {
      postMessage: (message) => worker.postMessage(message),
      terminate: () => void worker.terminate(),
      onMessage: (handler) => {
        worker.onmessage = (event) => handler(event.data);
      },
      onError: (handler) => {
        worker.onerror = (event) => handler(event.error || new Error(event.message));
      },
    };
  },
};

export class ForgeEngine extends Engine {
  constructor(options = {}) {
    super(browser, options);
  }
}

export async function createForgeEngine(options = {}) {
  const engine = new ForgeEngine(options);
  await engine.init();
  return engine;
}

export { VERSION, BUILD_COMMIT } from "./stamp.js";
