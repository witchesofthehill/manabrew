import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ForgeEngine } from "../../packages/forge-wasm/node.js";
import {
  forgeAiActivity,
  forgeAiDeck,
  forgeAiOpponentDeck,
  scriptedAnswer,
} from "./journal-fixture.mjs";

const { values } = parseArgs({
  options: { launcher: { type: "string" }, wasm: { type: "string" } },
});
const changes = new EventEmitter();
const states = new Map();
const prompts = [];
let failure;
const engine = new ForgeEngine({
  launcherUrl: values.launcher && resolve(values.launcher),
  wasmUrl: values.wasm && resolve(values.wasm),
  onState({ gameView }, seat) {
    states.set(seat, gameView);
    changes.emit("update");
  },
  onPrompt(prompt, seat) {
    prompts.push({ prompt, seat, state: states.get(seat) });
    changes.emit("update");
  },
  onError(error) {
    failure = new Error(JSON.stringify(error));
    changes.emit("update");
  },
  onEvent(event, payload) {
    if (event === "game:forced_end" || (event === "forge:log" && payload.level === "error")) {
      failure = new Error(payload.message ?? payload.text);
      changes.emit("update");
    }
  },
});

async function until(read) {
  const signal = AbortSignal.timeout(120_000);
  for (;;) {
    if (failure) throw failure;
    const value = read();
    if (value) return value;
    await once(changes, "update", { signal });
  }
}

async function nextPrompt() {
  for (;;) {
    const boundary = await until(() => prompts.shift());
    if (boundary.prompt.input.type !== "diceRolled") {
      assert.notEqual(boundary.seat, "player-2", "Forge AI must not require external answers");
      return boundary;
    }
    answer(boundary);
  }
}

function answer({ prompt, seat }) {
  engine.respond(prompt.promptId, scriptedAnswer({ prompt }), seat);
}

function board(state) {
  const { checkpoints, decisionHistory, restoreVote, ...rest } = state;
  return rest;
}

try {
  await engine.startMultiplayerGame({
    gameId: "forge-ai-webimage-rewind",
    decks: [forgeAiOpponentDeck, forgeAiOpponentDeck, forgeAiDeck],
    playerNames: ["Player 0", "Player 1", "Forge AI"],
    enginePlayerIndex: 0,
    forgeAiSeats: [2],
    forgeAiPolicy: "deterministic-v1",
    seed: 42,
    startingLife: 1000,
    decisionJournal: true,
    journalRewind: true,
    snapshotRecording: false,
  });
  const boundaries = [];
  let pending = await nextPrompt();
  for (let i = 0; i < 330; i++) {
    assert(pending.state.decisionHistory);
    assert.equal(pending.state.snapshotRecording, false);
    const consumed = pending;
    answer(pending);
    pending = await nextPrompt();
    boundaries.push({ ...consumed, checkpointId: pending.state.checkpoints.at(-1)?.checkpointId });
  }
  const target = 140;
  const index = boundaries.findIndex((boundary) => boundary.checkpointId === target);
  assert.notEqual(index, -1, "no prompt recorded for the rewind target");
  const expected = boundaries.slice(index);
  assert.deepEqual(forgeAiActivity(expected.map(({ state }) => state)), {
    targetedSpell: true,
    attack: true,
  });
  const checkpoint = pending.state.checkpoints.find((entry) => entry.checkpointId === target);
  assert(checkpoint, "target checkpoint absent");
  engine.directive({ type: "requestRestore", checkpointId: checkpoint.checkpointId });
  const vote = await until(() => {
    const vote = states.get(undefined)?.restoreVote;
    return vote?.status.type === "pending" && vote;
  });
  assert.deepEqual(vote.awaitingPlayerIds, ["player-1"]);
  engine.directive({ type: "restoreVote", voteId: vote.voteId, accept: true }, "player-1");

  let restored = await nextPrompt();
  const offset = restored.prompt.promptId - expected[0].prompt.promptId;
  assert.equal(restored.prompt.promptId, pending.prompt.promptId + 1);
  assert.equal(restored.state.restoreVote?.status.type, "approved");
  for (const boundary of expected) {
    assert.deepEqual(
      { ...restored.prompt, promptId: restored.prompt.promptId - offset },
      boundary.prompt,
    );
    assert.equal(restored.seat, boundary.seat);
    assert.deepEqual(board(restored.state), board(boundary.state));
    answer(restored);
    restored = await nextPrompt();
  }
  assert.deepEqual(
    { ...restored.prompt, promptId: restored.prompt.promptId - offset },
    pending.prompt,
  );
  assert.equal(restored.seat, pending.seat);
  assert.deepEqual(board(restored.state), board(pending.state));
  console.log(`PASS: Web Image Forge AI rewind matched ${expected.length + 1} prompts and views`);
} finally {
  if (engine.worker) await engine.command("end_game").catch(() => {});
  engine.dispose();
}
