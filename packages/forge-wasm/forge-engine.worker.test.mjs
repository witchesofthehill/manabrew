import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";
import {
  createDirectiveLane,
  writeDirectiveLane,
  createSeat,
  writeSeatMessage,
} from "./seat.js";

const source = readFileSync(
  new URL("./forge-engine.worker.js", import.meta.url),
  "utf8",
);
function fixture(started = true) {
  const workers = [],
    output = [],
    timers = new Map();
  let timerId = 0;
  class Worker {
    sent = [];
    terminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage(data) {
      this.sent.push(data);
    }
    terminate() {
      this.terminated = true;
    }
    event(event, payload) {
      this.onmessage({ data: { type: "event", event, payload } });
    }
    response(requestId, payload) {
      this.onmessage({ data: { type: "response", requestId, payload } });
    }
  }
  const self = { location: { href: "worker.js" }, postMessage: (data) => output.push(data) };
  const context = vm.createContext({
    self,
    Worker,
    SharedArrayBuffer,
    Int32Array,
    Atomics,
    console: {},
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context);
  vm.runInContext(
    'supervise({type:"command",command:"start_game",requestId:"start",args:{}})',
    context,
  );
  const active = workers[0];
  active.event("worker:init", { stage: "ready" });
  if (started) active.response("start", "game-started");
  const lanes = {
    buffers: [new SharedArrayBuffer(4096)],
    hostBuffer: new SharedArrayBuffer(4096),
    localSeat: 0,
  };
  active.event("game:directive_lanes", lanes);
  const rewind = (worker = active) => {
    worker.event("forge:rewind", { lastPromptId: 50, prompt: { promptId: 10 } });
    const candidate = workers.at(-1);
    candidate.event("worker:init", { stage: "ready" });
    assert.equal(candidate.sent[0].args.rewindDirectiveLanes, lanes);
    candidate.event("game:sab", { buffer: new SharedArrayBuffer(256 * 1024) });
    candidate.event("game:directive_lanes", lanes);
    return candidate;
  };
  const command = (name, id = name) =>
    self.onmessage({ data: { type: "command", command: name, requestId: id } });
  const responses = (id) =>
    output.filter((data) => data.type === "response" && data.requestId === id);
  return { workers, output, timers, active, lanes, rewind, command, responses };
}

test("commands resolve before, during and after consecutive promotions", () => {
  const f = fixture();
  let active = f.active;
  for (let n = 0; n < 3; n++) {
    f.command("get_prompt", `before${n}`);
    const candidate = f.rewind(active);
    f.command("get_game_view", `during${n}`);
    f.command("respond", `ready${n}`);
    candidate.event("forge:replay_ready");
    f.command("get_prompt", `after${n}`);
    for (const id of [`before${n}`, `during${n}`, `ready${n}`, `after${n}`]) {
      assert.equal(f.responses(id).length, 1);
      assert.equal(f.responses(id)[0].payload, null);
    }
    assert(active.terminated);
    assert.equal(candidate.sent.length, 1, "no commands sent into blocked leaf event loop");
    assert.equal(Atomics.load(new Int32Array(candidate.sent[0].args.rewindControl), 0), 2);
    active = candidate;
  }
  f.command("end_game");
  assert(f.workers.every((worker) => worker.terminated));
  assert.equal(f.timers.size, 0);
});

test("failed candidate and timeout resume original and answer commands", () => {
  for (const failure of ["error", "exit", "timeout"]) {
    const f = fixture();
    const candidate = f.rewind();
    f.command("get_prompt", "pending");
    if (failure === "error") candidate.onerror({ message: "crash" });
    if (failure === "exit") candidate.event("game:over", {});
    if (failure === "timeout") [...f.timers.values()][0]();
    assert(candidate.terminated);
    assert(!f.active.terminated);
    assert.equal(Atomics.load(new Int32Array(f.active.sent[0].args.rewindControl), 0), 1);
    f.command("respond", "continued");
    assert.equal(f.responses("pending").length, 1);
    assert.equal(f.responses("continued").length, 1);
    const next = f.rewind();
    next.event("forge:replay_ready");
    assert(f.active.terminated);
    f.command("end_game");
  }
});

test("termination or original failure cancels candidate and ignores late promotion", () => {
  for (const failure of ["end", "error", "forced_end", "over"]) {
    const f = fixture();
    const candidate = f.rewind();
    if (failure === "end") f.command("end_game");
    if (failure === "error") f.active.onerror({ message: "source crash" });
    if (["forced_end", "over"].includes(failure)) f.active.event(`game:${failure}`, {});
    const events = f.output.length;
    candidate.event("forge:replay_ready");
    f.active.event("forge:rewind", {});
    assert.equal(f.output.length, events);
    assert(f.workers.every((worker) => worker.terminated));
    assert.equal(f.timers.size, 0);
    f.command("get_prompt", "late");
    assert(f.responses("late")[0].error);
  }
});

test("end during startup settles the original pending request once", () => {
  const f = fixture(false);
  f.command("end_game");
  f.active.response("start", "game-started");
  assert.equal(f.responses("start").length, 1);
  assert(f.responses("start")[0].error);
});

test("full directive lane and UI queue survive promotion, cancellation stops flushing", async () => {
  const f = fixture();
  const lane = createDirectiveLane(f.lanes.buffers[0]);
  writeDirectiveLane(lane, { type: "concede" });
  writeDirectiveLane(lane, { type: "requestRestore", checkpointId: 1 });
  const candidate = f.rewind();
  candidate.event("forge:replay_ready");
  assert.equal(f.output.filter((data) => data.event === "game:directive_lanes").length, 1);
  assert.equal(Atomics.load(lane.signal, 0), 1);
  assert.equal(
    JSON.parse(new TextDecoder().decode(lane.data.slice(0, lane.signal[1]))).type,
    "concede",
  );
  Atomics.store(lane.signal, 0, 0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lane.queue.length, 0);
  assert.equal(
    JSON.parse(new TextDecoder().decode(lane.data.slice(0, lane.signal[1]))).type,
    "requestRestore",
  );
  writeDirectiveLane(lane, { type: "concede" });
  lane.cancelled = true;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lane.flushScheduled, false);
  assert.equal(lane.queue.length, 0);
  f.command("end_game");
});

test("UI termination rejects game requests, preserves query requests, cancels directive queues", async () => {
  const { transpileModule, ScriptTarget } = await import("typescript");
  const web = readFileSync(new URL("../../src/platform/web.ts", import.meta.url), "utf8");
  const start = web.indexOf("class WorkerBridge {");
  const end = web.indexOf("// Web Game API", start);
  const js = transpileModule(
    web
      .slice(start, end)
      .replaceAll("import.meta.url", JSON.stringify("https://test.invalid/web.ts")),
    { compilerOptions: { target: ScriptTarget.ES2022 } },
  ).outputText;
  const events = new Map();
  const eventBus = { on: (name, handler) => events.set(name, handler) };
  const context = vm.createContext({
    setForgeWasmActive() {},
    eventBus,
    writeSeatMessage,
    DEBUG_TRANSPORT: false,
  });
  vm.runInContext(
    js.replaceAll("import.meta.url", JSON.stringify("https://test.invalid/web.ts")) +
      "\nglobalThis.bridge = new WorkerBridge(eventBus);",
    context,
  );
  const bridge = context.bridge;
  const remote = createSeat(new SharedArrayBuffer(256 * 1024));
  bridge.remoteSeats.set("player-1", remote);
  bridge.remotePlayerSlots.set("bob", "player-1");
  const remoteReply = (promptId) =>
    events.get("server:state_update")({
      from_player: "bob",
      state: {
        kind: "response",
        fromPlayer: "player-1",
        promptId,
        action: { type: "chooseAction", output: { type: "pass" } },
      },
    });
  remoteReply(0);
  assert.equal(Atomics.load(remote.signal, 0), 0, "uncorrelated remote answer reached the engine");
  remoteReply(7);
  assert.equal(Atomics.load(remote.signal, 0), 2);
  const gameWorker = { terminate() {} },
    queryWorker = {};
  bridge.worker = gameWorker;
  bridge.fallbackWorker = queryWorker;
  let rejected = 0;
  bridge.pendingRequests.set("game", { worker: gameWorker, reject: () => rejected++ });
  bridge.pendingRequests.set("query", {
    worker: queryWorker,
    reject: () => assert.fail("query cancelled"),
  });
  const lane = createDirectiveLane(new SharedArrayBuffer(4096));
  writeDirectiveLane(lane, { type: "concede" });
  writeDirectiveLane(lane, { type: "concede" });
  bridge.directiveLanes = {
    lanes: [lane],
    host: createDirectiveLane(new SharedArrayBuffer(4096)),
    localSeat: 0,
  };
  bridge.terminate();
  assert.equal(rejected, 1);
  assert.equal(bridge.pendingRequests.size, 1);
  assert(bridge.pendingRequests.has("query"));
  assert(lane.cancelled);
  assert.equal(bridge.directiveLanes, null);
});

test("normal game end delivers a late final SAB prompt before stopping its reader", async () => {
  const { ForgeEngine } = await import("../../packages/forge-wasm/engine.js");
  let receive;
  const prompts = [];
  const engine = new ForgeEngine(
    {
      locations: () => ({}),
      unsupported: () => false,
      spawnWorker: () => ({
        onMessage: (callback) => {
          receive = callback;
        },
        onError() {},
        terminate() {},
      }),
    },
    { onPrompt: (prompt) => prompts.push(prompt) },
  );
  const initialized = engine.init();
  receive({ type: "event", event: "worker:init", payload: { stage: "ready" } });
  await initialized;
  receive({
    type: "event",
    event: "game:sab",
    payload: { buffer: new SharedArrayBuffer(256 * 1024) },
  });
  const seat = engine.seats.get("local");
  receive({ type: "event", event: "game:over", payload: {} });
  assert(!seat.cancelled);
  const bytes = new TextEncoder().encode(
    JSON.stringify({ kind: "prompt", prompt: { promptId: 1000001, input: { type: "gameOver" } } }),
  );
  seat.data.set(bytes);
  Atomics.store(seat.signal, 1, bytes.length);
  Atomics.store(seat.signal, 0, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(prompts.length, 1);
  assert(seat.cancelled);
  engine.dispose();
});
