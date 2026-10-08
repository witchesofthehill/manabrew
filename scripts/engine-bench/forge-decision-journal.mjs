import { harness as createHarness } from "./journal-harness.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createForgeEngine } from "../../packages/forge-wasm/node.js";
import { resolve } from "node:path";
import { deck, scriptedAnswer } from "./journal-fixture.mjs";

const { values } = parseArgs({
  options: {
    jar: { type: "string" },
    launcher: { type: "string" },
    "forge-home": { type: "string" },
    java: { type: "string", default: "java" },
    decisions: { type: "string", default: "80" },
  },
});
assert(values.jar && values["forge-home"], "--jar and --forge-home are required");
const decisions = Number(values.decisions);
assert(Number.isSafeInteger(decisions) && decisions > 0);
const sessionId = "decision-journal-probe";
const request = {
  gameId: sessionId,
  variant: "Constructed",
  startingLife: 20,
  seed: 43,
  snapshotRecording: false,
  decisionJournal: true,
  players: [0, 1].map((seat) => ({
    name: `Player ${seat}`,
    ai: false,
    bot: seat === 1,
    deck: deck.cards.flatMap(({ name, count }) => Array.from({ length: count }, () => ({ name }))),
  })),
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

const harness = () =>
  createHarness({
    java: values.java,
    jar: values.jar,
    forgeHome: values["forge-home"],
    sessionId,
  });

async function views(engine) {
  const result = [];
  for (const viewer of [0, 1])
    result.push(JSON.parse(await engine.call("getSnapshot", { viewer })));
  return result;
}

const entries = [];
let startRequest, terminalPrompt, terminalViews;
const source = harness();
try {
  await source.call("startGame", { payload: JSON.stringify(request) });
  let prompt = await source.prompt();
  const first = await source.drain();
  assert.equal(first.version, 1);
  startRequest = first.startRequest;
  assert.deepEqual(JSON.parse(startRequest), request);
  assert.deepEqual(first.entries, []);
  assert.equal(await source.drain(), null);
  await assert.rejects(source.call("readDecisionJournal"), /cannot mix/);
  for (let index = 0; index < decisions; index++) {
    if (index === 3) {
      const action = {
        type: "directive",
        player: -1,
        directive: { type: "setSnapshotRecording", enabled: false },
      };
      await source.call("submitAction", { payload: JSON.stringify(action) });
      const batch = await source.consumed();
      assert.equal(batch.entries.length, 1);
      assert.deepEqual(batch.entries[0].action, action);
      assert.deepEqual(batch.entries[0].prompt, prompt);
      assert.equal(batch.entries[0].sequence, entries.length + 1);
      entries.push(batch.entries[0]);
    }
    const action = scriptedAnswer({ prompt });
    await source.call("submitAction", { payload: JSON.stringify(action) });
    const next = await source.prompt(prompt.promptId);
    const batch = await source.drain();
    assert.equal(batch.unavailableReason, undefined);
    assert.equal(batch.startRequest, undefined);
    assert.equal(batch.entries.length, 1);
    assert.equal(batch.nextSequence, entries.length + 2);
    const entry = batch.entries[0];
    assert.equal(entry.sequence, entries.length + 1);
    assert.deepEqual(entry.prompt, prompt);
    assert.deepEqual(entry.action, action);
    assert.equal(entry.playerIndex, Number(prompt.decidingPlayerId?.split("-")[1] ?? -1));
    entries.push(entry);
    prompt = next;
  }
  terminalPrompt = prompt;
  terminalViews = await views(source);
  await source.call("submitAction", {
    payload: JSON.stringify({
      type: "directive",
      player: 0,
      directive: { type: "requestRestore", checkpointId: 999999 },
    }),
  });
  assert.match((await source.consumed()).unavailableReason, /snapshot restore/);
} finally {
  source.close();
}

const shadow = harness();
try {
  await shadow.call("startGame", { payload: startRequest });
  let prompt = await shadow.prompt();
  await shadow.drain();
  for (const entry of entries) {
    assert.deepEqual(prompt, entry.prompt, `divergence before decision ${entry.sequence}`);
    await shadow.call("submitAction", { payload: JSON.stringify(entry.action) });
    if (entry.action.type !== "directive") prompt = await shadow.prompt(prompt.promptId);
    const batch = await shadow.consumed();
    assert.deepEqual(batch.entries, [entry]);
  }
  assert.deepEqual(prompt, terminalPrompt);
  assert.deepEqual(await views(shadow), terminalViews);

  const action = scriptedAnswer({ prompt });
  action.padding = "x".repeat(8 * 1024 * 1024);
  await shadow.call("submitAction", { payload: JSON.stringify(action) });
  prompt = await shadow.prompt(prompt.promptId);
  const overflow = await shadow.drain();
  assert.match(overflow.unavailableReason, /limit/);
  assert.deepEqual(overflow.entries, []);
  assert.equal(await shadow.drain(), null);
  await shadow.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  await shadow.prompt(prompt.promptId);
  assert.equal(await shadow.drain(), null);
} finally {
  shadow.close();
}

const gated = harness();
try {
  await assert.rejects(
    gated.call("startGame", {
      payload: JSON.stringify({
        ...request,
        decisionJournal: false,
        decisionJournalCommitBarrier: true,
      }),
    }),
    /requires decisionJournal/,
  );
  await gated.call("startGame", {
    payload: JSON.stringify({ ...request, decisionJournalCommitBarrier: true }),
  });
  const read = async () => JSON.parse(await gated.call("readDecisionJournal"));
  const acknowledge = (sequence) => gated.call("acknowledgeDecisionJournal", { sequence });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await gated.call("getPrompt", { playerIndex: 0 }), "");
  const gatedManifest = await read();
  assert.equal(gatedManifest.nextSequence, 1);
  assert.equal(gatedManifest.commitBarrier, true);
  await assert.rejects(gated.drain(), /cannot mix/);
  await acknowledge(0);
  let prompt = await gated.prompt();
  for (let sequence = 1; sequence <= 5; sequence++) {
    const before = await views(gated);
    await gated.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
    const deadline = performance.now() + 10_000;
    let batch;
    do {
      const raw = await gated.call("readDecisionJournal");
      if (raw) batch = JSON.parse(raw);
      if (batch?.entries.length) break;
      await pause();
    } while (performance.now() < deadline);
    assert.equal(batch?.entries[0].sequence, sequence);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(await views(gated), before);
    assert.deepEqual(JSON.parse(await gated.call("getPrompt", { playerIndex: 0 })), prompt);
    await acknowledge(sequence - 1);
    assert.deepEqual(await read(), batch);
    await acknowledge(sequence);
    prompt = await gated.prompt(prompt.promptId);
  }
  await gated.call("submitAction", {
    payload: JSON.stringify({
      type: "directive",
      player: 0,
      directive: { type: "requestRestore", checkpointId: 1 },
    }),
  });
  const deadline = performance.now() + 10_000;
  while (true) {
    try {
      await gated.call("getGameOver");
    } catch (error) {
      assert.match(error.message, /journal unavailable/);
      break;
    }
    assert(performance.now() < deadline, "restore must fail closed");
    await pause();
  }
  await gated.call("endGame");
  await gated.call("startGame", {
    payload: JSON.stringify({ ...request, decisionJournalCommitBarrier: true }),
  });
  const started = performance.now();
  await gated.call("endGame");
  assert(performance.now() - started < 2000, "close must wake the manifest barrier");
  await gated.call("startGame", {
    payload: JSON.stringify({ ...request, decisionJournalCommitBarrier: true }),
  });
  await read();
  await acknowledge(0);
  prompt = await gated.prompt();
  await gated.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  const decisionDeadline = performance.now() + 10_000;
  while (!(await gated.call("readDecisionJournal"))) {
    assert(performance.now() < decisionDeadline, "decision must reach the barrier");
    await pause();
  }
  const closing = performance.now();
  await gated.call("endGame");
  assert(performance.now() - closing < 2000, "close must wake the decision barrier");
} finally {
  gated.close();
}

const retained = harness();
try {
  await retained.call("startGame", { payload: JSON.stringify(request) });
  let prompt = await retained.prompt();
  const read = () => retained.call("readDecisionJournal");
  const acknowledge = (sequence) => retained.call("acknowledgeDecisionJournal", { sequence });
  await assert.rejects(acknowledge(0), /read prefix/);
  const manifest = await read();
  assert.equal(await read(), manifest, "lost manifest delivery must be retryable");
  await assert.rejects(retained.drain(), /cannot mix/);
  await assert.rejects(acknowledge(-1), /read prefix/);
  await assert.rejects(acknowledge(0.5));
  await acknowledge(0);
  await acknowledge(0);
  assert.equal(await read(), "");
  for (let pair = 0; pair < 5; pair++) {
    const actions = [];
    for (let index = 0; index < 2; index++) {
      const action = scriptedAnswer({ prompt });
      action.padding = "x".repeat(1024 * 1024);
      actions.push(action);
      await retained.call("submitAction", { payload: JSON.stringify(action) });
      prompt = await retained.prompt(prompt.promptId);
    }
    const sequence = pair * 2 + 2;
    await assert.rejects(acknowledge(sequence), /read prefix/);
    const raw = await read();
    const batch = JSON.parse(raw);
    assert.equal(await read(), raw, "lost batch delivery must be retryable");
    assert.equal(batch.unavailableReason, undefined);
    assert.equal(batch.startRequest, undefined);
    assert.equal(batch.nextSequence, sequence + 1);
    assert.deepEqual(
      batch.entries.map((entry) => entry.action),
      actions,
    );
    await acknowledge(sequence - 1);
    assert.deepEqual(JSON.parse(await read()).entries, [batch.entries[1]]);
    await acknowledge(sequence - 2);
    await acknowledge(sequence - 1);
    assert.deepEqual(JSON.parse(await read()).entries, [batch.entries[1]]);
    await acknowledge(sequence);
    assert.equal(await read(), "");
  }
  const action = scriptedAnswer({ prompt });
  action.padding = "x".repeat(8 * 1024 * 1024);
  await retained.call("submitAction", { payload: JSON.stringify(action) });
  prompt = await retained.prompt(prompt.promptId);
  const failure = await read();
  assert.match(JSON.parse(failure).unavailableReason, /limit/);
  assert.equal(await read(), failure, "invalidation must survive lost delivery");
  await assert.rejects(acknowledge(10), /unavailable/);
  await retained.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  await retained.prompt(prompt.promptId);
  assert.equal(await read(), failure);
} finally {
  retained.close();
}

const disabled = harness();
try {
  const aiRequest = structuredClone(request);
  aiRequest.players[1].ai = true;
  await assert.rejects(
    disabled.call("startGame", { payload: JSON.stringify(aiRequest) }),
    /external decisions/,
  );
  await assert.rejects(
    disabled.call("startGame", {
      payload: JSON.stringify({ ...request, checkpoint: "{}" }),
    }),
    /external decisions/,
  );
  await disabled.call("startGame", {
    payload: JSON.stringify({ ...request, decisionJournal: false }),
  });
  const prompt = await disabled.prompt();
  await disabled.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  await disabled.prompt(prompt.promptId);
  assert.equal(await disabled.drain(), null);
} finally {
  disabled.close();
}

let wasm;
if (values.launcher) {
  const queue = [],
    recorded = [],
    sent = new Map();
  let wake, failure, manifest;
  const engine = await createForgeEngine({
    launcherUrl: resolve(values.launcher),
    wasmUrl: resolve(`${values.launcher}.wasm`),
    onPrompt: (prompt, slot) => {
      queue.push({ prompt, slot });
      wake?.();
    },
    onError: (error) => {
      failure = error;
      wake?.();
    },
    onEvent: (event, batch) => {
      if (event !== "forge:journal") return;
      try {
        assert.equal(batch.version, 1);
        assert.equal(batch.unavailableReason, undefined);
        if (batch.startRequest) {
          assert.equal(manifest, undefined);
          manifest = JSON.parse(batch.startRequest);
        }
        for (const entry of batch.entries) {
          assert.equal(entry.sequence, recorded.length + 1);
          assert.deepEqual(entry.action, sent.get(entry.prompt.promptId));
          recorded.push(entry);
        }
        assert.equal(batch.nextSequence, recorded.length + 1);
      } catch (error) {
        failure = error;
        wake?.();
      }
    },
  });
  let startupTimer;
  try {
    await Promise.race([
      engine.startGame({
        deck,
        opponentDecks: [deck],
        seed: 43,
        gameId: sessionId,
        snapshotRecording: false,
        decisionJournal: true,
      }),
      new Promise((_, reject) => {
        startupTimer = setTimeout(() => reject(new Error("WASM startup timeout")), 60_000);
      }),
    ]);
    clearTimeout(startupTimer);
    while (recorded.length < decisions) {
      if (!queue.length && !failure) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("WASM prompt timeout")), 30_000);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
      }
      if (failure) throw failure;
      if (recorded.length >= decisions) break;
      const frame = queue.shift();
      if (!frame) continue;
      const action = scriptedAnswer(frame);
      sent.set(frame.prompt.promptId, action);
      engine.respond(frame.prompt.promptId, action, frame.slot);
    }
    assert.equal(manifest.seed, 43);
    assert.equal(manifest.gameId, sessionId);
    wasm = { consumedDecisions: recorded.length, transport: "forge:journal", matched: true };
  } finally {
    clearTimeout(startupTimer);
    engine.dispose();
  }
}

console.log(
  JSON.stringify(
    {
      runtime: "JVM",
      decisions: entries.length,
      jarSha256: createHash("sha256")
        .update(await readFile(values.jar))
        .digest("hex"),
      replay: "matched prompts, consumed actions, and both terminal seat views",
      overflow: "explicit invalidation; game continued",
      rejected: ["internal AI", "checkpoint start"],
      disabled: "no journal batches",
      commitBarrier:
        "startup and decisions wait for acknowledgement; restore fails closed; shutdown wakes waiters",
      retainedDelivery:
        "retries, partial/duplicate acknowledgements, prefix validation, reclaimed capacity, persistent invalidation",
      wasm,
    },
    null,
    2,
  ),
);
