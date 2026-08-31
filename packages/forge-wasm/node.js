import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { ForgeEngine as Engine } from "./engine.js";

const sibling = (name) => fileURLToPath(new URL(name, import.meta.url));

/** The launcher and the cardset are read with `fs`, which wants a path. */
function asPath(value, fallback) {
  if (!value) return fallback;
  if (value instanceof URL) return fileURLToPath(value);
  return value.startsWith("file:") ? fileURLToPath(new URL(value)) : value;
}

const node = {
  locations: (options) => ({
    worker: asPath(options.workerUrl, sibling("./forge-engine.worker.js")),
    launcher: asPath(options.launcherUrl, sibling("./forgeharness.js")),
    wasm: asPath(options.wasmUrl, sibling("./forgeharness.js.wasm")),
    cardset: asPath(options.cardsetUrl, sibling("./cardset.rkyv")),
    assetWasm: asPath(options.assetWasmUrl, sibling("./forge-assets_bg.wasm")),
  }),

  // Node has SharedArrayBuffer unconditionally, so there is no cross-origin
  // isolation to check for.
  unsupported: () => null,

  spawnWorker(location) {
    // The launcher reads argv from `process.argv` on Node, where a browser
    // worker hands it `scriptArgs`.
    const worker = new Worker(sibling("./node-worker.cjs"), {
      workerData: { workerScript: location },
      argv: ["--serve"],
    });
    return {
      postMessage: (message) => worker.postMessage(message),
      terminate: () => void worker.terminate(),
      onMessage: (handler) => worker.on("message", handler),
      onError: (handler) => worker.on("error", handler),
    };
  },

  assetModule: (location) => readFile(location),

  readCardset: async (location) => new Uint8Array(await readFile(location)),
};

export class ForgeEngine extends Engine {
  constructor(options = {}) {
    super(node, options);
  }
}

export async function createForgeEngine(options = {}) {
  const engine = new ForgeEngine(options);
  await engine.init();
  return engine;
}

export { VERSION, CARDSET_ARCHIVE_VERSION, BUILD_COMMIT } from "./stamp.js";
