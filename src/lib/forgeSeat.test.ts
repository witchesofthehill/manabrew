import { afterEach, describe, expect, it } from "vitest";
import {
  createSeat,
  deliverSeatDirective,
  pollSeat,
  writeSeatMessage,
  SAB_SIZE,
  SIGNAL_IDLE,
  SIGNAL_PROMPT_READY,
  SIGNAL_RESPONSE_READY,
  SIGNAL_PROMPT_ACKNOWLEDGED,
  type ForgeSeat,
} from "@forge-wasm/seat.js";

const open: ForgeSeat[] = [];

function seat(): ForgeSeat {
  const created = createSeat(new SharedArrayBuffer(SAB_SIZE));
  open.push(created);
  return created;
}

/** The other side of the exchange: the engine writes and blocks. */
function engineWrites(target: ForgeSeat, message: unknown): void {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  target.data.set(bytes, 0);
  Atomics.store(target.signal, 1, bytes.length);
  Atomics.store(target.signal, 0, SIGNAL_PROMPT_READY);
}

function engineReads(target: ForgeSeat): unknown {
  const length = Atomics.load(target.signal, 1);
  return JSON.parse(new TextDecoder().decode(target.data.slice(0, length)));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  for (const created of open.splice(0)) created.cancelled = true;
});

describe("forge seat", () => {
  it("rejects a buffer that is not a seat", () => {
    expect(() => createSeat(new SharedArrayBuffer(64))).toThrow(/expected/);
  });

  it("reads a message once and acknowledges it", async () => {
    const local = seat();
    const seen: unknown[] = [];
    pollSeat(local, (message) => seen.push(message));

    engineWrites(local, { kind: "state", state: { turn: 1 } });
    await tick();
    await tick();

    expect(seen).toEqual([{ kind: "state", state: { turn: 1 } }]);
    expect(Atomics.load(local.signal, 0)).toBe(SIGNAL_PROMPT_ACKNOWLEDGED);

    // Acknowledged, so a second pass must not deliver it again.
    await tick();
    expect(seen).toHaveLength(1);
  });

  it("marks the seat awaiting input on a prompt, and clears it on the answer", async () => {
    const local = seat();
    pollSeat(local, () => {});

    engineWrites(local, { kind: "prompt", prompt: { id: 7 } });
    await tick();
    await tick();
    expect(local.awaitingResponse).toBe(true);

    writeSeatMessage(local, { kind: "response", promptId: 7, action: { type: "pass" } });
    expect(local.awaitingResponse).toBe(false);
    expect(Atomics.load(local.signal, 0)).toBe(SIGNAL_RESPONSE_READY);
    expect(engineReads(local)).toEqual({
      kind: "response",
      promptId: 7,
      action: { type: "pass" },
    });
  });

  it("holds a directive raised between prompts until the engine blocks", async () => {
    const local = seat();
    const seen: unknown[] = [];
    pollSeat(local, (message) => seen.push(message));

    // The engine is thinking: nothing may be written, or it would be
    // overwritten before the engine ever read it.
    deliverSeatDirective(local, { kind: "concede" });
    expect(Atomics.load(local.signal, 0)).toBe(SIGNAL_IDLE);
    expect(local.pendingDirective).toEqual({ kind: "concede" });

    engineWrites(local, { kind: "prompt", prompt: { id: 3 } });
    await tick();
    await tick();

    // Flushed the moment the engine blocked, ahead of the prompt being shown.
    expect(engineReads(local)).toEqual({ kind: "directive", directive: { kind: "concede" } });
    expect(Atomics.load(local.signal, 0)).toBe(SIGNAL_RESPONSE_READY);
    expect(local.pendingDirective).toBeNull();
    expect(seen).toEqual([{ kind: "prompt", prompt: { id: 3 } }]);
  });

  it("writes a directive straight through when the engine is already blocked", async () => {
    const local = seat();
    pollSeat(local, () => {});

    engineWrites(local, { kind: "prompt", prompt: { id: 1 } });
    await tick();
    await tick();

    deliverSeatDirective(local, { kind: "concede" });
    expect(local.pendingDirective).toBeNull();
    expect(engineReads(local)).toEqual({ kind: "directive", directive: { kind: "concede" } });
  });

  it("reports a malformed message instead of ending the poll loop", async () => {
    const local = seat();
    const seen: unknown[] = [];
    const errors: unknown[] = [];
    pollSeat(
      local,
      (message) => seen.push(message),
      (error) => errors.push(error),
    );

    const junk = new TextEncoder().encode("{not json");
    local.data.set(junk, 0);
    Atomics.store(local.signal, 1, junk.length);
    Atomics.store(local.signal, 0, SIGNAL_PROMPT_READY);
    await tick();
    await tick();
    expect(errors).toHaveLength(1);

    engineWrites(local, { kind: "state", state: {} });
    await tick();
    await tick();
    expect(seen).toEqual([{ kind: "state", state: {} }]);
  });

  it("stops when cancelled", async () => {
    const local = seat();
    const seen: unknown[] = [];
    pollSeat(local, (message) => seen.push(message));

    local.cancelled = true;
    await tick();
    engineWrites(local, { kind: "state", state: {} });
    await tick();
    await tick();

    expect(seen).toEqual([]);
  });

  it("refuses a message larger than the seat", () => {
    const local = seat();
    expect(() => writeSeatMessage(local, { blob: "x".repeat(SAB_SIZE) })).toThrow(/capacity/);
  });
});
