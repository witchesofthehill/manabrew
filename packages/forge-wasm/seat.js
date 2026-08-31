/**
 * One seat's SharedArrayBuffer exchange with the Forge worker.
 *
 * Forge runs a game synchronously inside the worker, so it cannot answer a
 * postMessage while it is waiting for a player. Instead each seat gets a SAB:
 * the engine writes a message and blocks, the main thread reads it and writes
 * an answer back, and `Atomics.notify` wakes the engine.
 *
 * Layout: two `Int32` slots, then the JSON body.
 *
 *   signal[0]  where the exchange is (see the constants below)
 *   signal[1]  the body's length in bytes
 *   data       the body, UTF-8
 *
 * This is the one implementation. Manabrew's own client imports it rather than
 * keeping a second copy that can drift from the published package.
 */

export const SAB_SIZE = 256 * 1024;

/** Nothing to read; the engine is working. */
export const SIGNAL_IDLE = 0;
/** The engine wrote a message and is waiting on this seat. */
export const SIGNAL_PROMPT_READY = 1;
/** We wrote an answer; the engine may take it. */
export const SIGNAL_RESPONSE_READY = 2;
/** We took the message, and have not answered yet. */
export const SIGNAL_PROMPT_ACKNOWLEDGED = 3;

const HEADER_BYTES = 8;

function schedule(callback) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
  return setTimeout(callback, 0);
}

/** Wrap a buffer the worker handed over, rejecting one that is not a seat. */
export function createSeat(buffer) {
  if (typeof SharedArrayBuffer === "undefined" || !(buffer instanceof SharedArrayBuffer)) {
    throw new Error("Forge seat buffer is not a SharedArrayBuffer.");
  }
  if (buffer.byteLength !== SAB_SIZE) {
    throw new Error(`Forge seat buffer is ${buffer.byteLength} bytes, expected ${SAB_SIZE}.`);
  }
  return {
    buffer,
    signal: new Int32Array(buffer, 0, 2),
    data: new Uint8Array(buffer, HEADER_BYTES),
    cancelled: false,
    awaitingResponse: false,
    pendingDirective: null,
  };
}

/**
 * The JSON the engine wrote, acknowledged so it is not read twice, or null
 * when the engine has written nothing.
 */
export function readSeatMessage(seat) {
  if (Atomics.load(seat.signal, 0) !== SIGNAL_PROMPT_READY) return null;
  const length = Atomics.load(seat.signal, 1);
  const json = new TextDecoder().decode(seat.data.slice(0, length));
  Atomics.store(seat.signal, 0, SIGNAL_PROMPT_ACKNOWLEDGED);
  Atomics.notify(seat.signal, 0);
  return json;
}

/** Write a message into the seat and wake the engine. */
export function writeSeatMessage(seat, message) {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  if (bytes.length > seat.data.length) {
    throw new Error("Forge seat message exceeds the SharedArrayBuffer capacity.");
  }
  seat.awaitingResponse = false;
  Atomics.store(seat.signal, 1, bytes.length);
  seat.data.set(bytes, 0);
  Atomics.store(seat.signal, 0, SIGNAL_RESPONSE_READY);
  Atomics.notify(seat.signal, 0);
}

/**
 * Deliver a directive: now if the engine is blocked on this seat's prompt,
 * otherwise at its next one. The seat holds a single message slot, so a
 * directive written while the engine is not waiting would be overwritten
 * before it read it.
 */
export function deliverSeatDirective(seat, directive) {
  if (seat.awaitingResponse) writeSeatMessage(seat, { kind: "directive", directive });
  else seat.pendingDirective = directive;
}

/**
 * Record a message just read off the seat and flush a directive that was
 * waiting for the engine to block. Call this before handing the message on,
 * so a conceding player's directive reaches the engine ahead of the prompt
 * being rendered.
 */
export function noteSeatMessage(seat, message) {
  if (message?.kind !== "prompt") return;
  seat.awaitingResponse = true;
  const directive = seat.pendingDirective;
  if (directive === null) return;
  seat.pendingDirective = null;
  writeSeatMessage(seat, { kind: "directive", directive });
}

/**
 * Poll the seat until it is cancelled, handing each parsed message to
 * `onMessage`. Polling rather than `Atomics.wait` because the main thread
 * cannot block, and on an animation frame because that is the rate the board
 * can be redrawn at anyway.
 */
export function pollSeat(seat, onMessage, onError) {
  const poll = () => {
    if (seat.cancelled) return;
    const json = readSeatMessage(seat);
    if (json !== null) {
      try {
        const message = JSON.parse(json);
        noteSeatMessage(seat, message);
        onMessage(message, json);
      } catch (error) {
        onError?.(error, json);
      }
    }
    schedule(poll);
  };
  schedule(poll);
}
