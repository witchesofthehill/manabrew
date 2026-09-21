/**
 * One Manabot seat at a Forge wasm table.
 *
 * The engine writes every state and prompt for this seat into a
 * SharedArrayBuffer and blocks until the reader acknowledges it. Reading from
 * the main thread meant one animation frame per message, times three seats,
 * on every state change; here `Atomics.wait` wakes the moment the engine
 * writes. One worker per seat keeps the wait blocking and simple: the engine
 * talks to one seat at a time, but not always the same one.
 *
 * Frames go to the wasm bot as the bytes the engine wrote, and the answer
 * comes back as the bytes the engine reads, so no JSON is parsed here.
 */

import init, { WasmManabot } from "../wasm/wasm";
import {
  SAB_SIZE,
  SIGNAL_PROMPT_READY,
  SIGNAL_PROMPT_ACKNOWLEDGED,
  SIGNAL_RESPONSE_READY,
} from "@forge-wasm/seat.js";

const HEADER_BYTES = 8;

interface SeatCommand {
  buffer: SharedArrayBuffer;
  playerSlot: string;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function takeFrame(signal: Int32Array, data: Uint8Array): string {
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
  return json;
}

function writeFrame(signal: Int32Array, data: Uint8Array, json: string): void {
  const bytes = encoder.encode(json);
  if (bytes.length > data.length) {
    throw new Error("Manabot response exceeds the shared buffer capacity.");
  }
  data.set(bytes, 0);
  Atomics.store(signal, 1, bytes.length);
  Atomics.store(signal, 0, SIGNAL_RESPONSE_READY);
  Atomics.notify(signal, 0);
}

/** The frame's `kind`, without parsing the rest; a state frame is a whole board. */
function frameKind(json: string): string {
  const match = /^\{"kind":"([a-zA-Z]+)"/.exec(json);
  return match ? match[1] : "";
}

function play(buffer: SharedArrayBuffer, playerSlot: string): never {
  const signal = new Int32Array(buffer, 0, 2);
  const data = new Uint8Array(buffer, HEADER_BYTES);
  const agent = new WasmManabot();
  // The engine broadcasts a state to every seat after each change, while a
  // prompt reaches this seat only on its own decisions. Hold the newest
  // state and hand it over when a prompt arrives, so the bot parses one
  // board per decision rather than one per change.
  let pendingState: string | null = null;

  for (;;) {
    const json = takeFrame(signal, data);
    const kind = frameKind(json);
    if (kind === "state") {
      pendingState = json;
      continue;
    }
    if (kind !== "prompt") continue;
    try {
      if (pendingState !== null) {
        agent.observe_frame(pendingState);
        pendingState = null;
      }
      const response = agent.answer_frame(json);
      if (response) writeFrame(signal, data, response);
    } catch (error) {
      console.error(`[Manabot] Failed to answer ${playerSlot}:`, error);
    }
  }
}

self.onmessage = async (event: MessageEvent<SeatCommand>) => {
  const { buffer, playerSlot } = event.data;
  if (!(buffer instanceof SharedArrayBuffer) || buffer.byteLength !== SAB_SIZE) {
    console.error(
      `[Manabot] ${playerSlot}: seat buffer is not a ${SAB_SIZE}-byte SharedArrayBuffer`,
    );
    return;
  }
  await init();
  // Never returns: the seat lives until the bridge terminates this worker.
  play(buffer, playerSlot);
};
