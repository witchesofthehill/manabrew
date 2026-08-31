/**
 * Runs `forge-engine.worker.js` on a Node worker thread.
 *
 * That file and the generated launcher are classic scripts written for a web
 * worker: they read `self`, call `postMessage` bare, and load each other with
 * `importScripts`. This supplies all three, then evaluates them as scripts.
 *
 * They cannot be `require`d. Both are `.js` inside a `"type": "module"`
 * package, so Node parses them as ESM, and the launcher needs the CommonJS
 * `require` and `__filename` in scope: that is how it finds `fs` to read the
 * WebAssembly module, and how it locates itself.
 */
const fs = require("fs");
const path = require("path");
const { parentPort, workerData } = require("worker_threads");

const workerScript = workerData.workerScript;

function runScript(file) {
  const code = fs.readFileSync(file, "utf8");
  const script = new Function("require", "__filename", "__dirname", code);
  script(require, file, path.dirname(file));
}

globalThis.self = globalThis;
globalThis.postMessage = (message) => parentPort.postMessage(message);
globalThis.importScripts = (location) => {
  const file = location.startsWith("file:") ? new URL(location).pathname : location;
  runScript(path.resolve(path.dirname(workerScript), file));
};

parentPort.on("message", (message) => {
  if (typeof globalThis.onmessage === "function") globalThis.onmessage({ data: message });
});

runScript(workerScript);
