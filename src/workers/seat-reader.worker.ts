/**
 * Reads one Forge seat buffer for the main thread.
 *
 * The engine blocks after every frame it writes until the reader acknowledges
 * it, and the main thread reads on animation frames, so each state broadcast
 * cost the engine a frame of waiting, several times per decision. This worker
 * acknowledges the moment the frame lands and forwards the JSON, so the
 * engine moves on while the board catches up at its own pace. Answers still
 * go straight from the main thread into the buffer.
 */

import { SAB_SIZE, SIGNAL_PROMPT_READY, SIGNAL_PROMPT_ACKNOWLEDGED } from "@forge-wasm/seat.js";

const HEADER_BYTES = 8;
const decoder = new TextDecoder();

self.onmessage = (event: MessageEvent<{ buffer: SharedArrayBuffer }>) => {
  const { buffer } = event.data;
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== SAB_SIZE) {
    console.error(`[seat-reader] seat buffer is not a ${SAB_SIZE}-byte SharedArrayBuffer`);
    return;
  }
  const signal = new Int32Array(buffer, 0, 2);
  const data = new Uint8Array(buffer, HEADER_BYTES);
  // Never returns: the seat lives until the bridge terminates this worker.
  for (;;) {
    for (;;) {
      const current = Atomics.load(signal, 0);
      if (current === SIGNAL_PROMPT_READY) break;
      Atomics.wait(signal, 0, current);
    }
    const length = Atomics.load(signal, 1);
    // A copy: TextDecoder refuses a view on shared memory.
    const json = decoder.decode(data.slice(0, length));
    Atomics.store(signal, 0, SIGNAL_PROMPT_ACKNOWLEDGED);
    Atomics.notify(signal, 0);
    self.postMessage(json);
  }
};
