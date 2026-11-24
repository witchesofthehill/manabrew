import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { harness } from "./journal-harness.mjs";
import {
  deck,
  forgeAiActivity,
  forgeAiDeck,
  forgeAiOpponentDeck,
  scriptedAnswer,
} from "./journal-fixture.mjs";

const { values } = parseArgs({
  options: {
    java: { type: "string", default: "java" },
    jar: {
      type: "string",
      default: "forge-harness/target/forge-harness-jar-with-dependencies.jar",
    },
    "forge-home": { type: "string", default: "forge/forge-gui" },
    native: { type: "string" },
    "forge-ai": { type: "boolean" },
  },
});
const sessionId = "journal-rewind-regression";
const options = { ...values, forgeHome: values["forge-home"], sessionId };
const flatten = (deck) =>
  deck.cards.flatMap(({ name, count }) => Array.from({ length: count }, () => ({ name })));
const forgeAi = values["forge-ai"];
const humanDeck = flatten(forgeAi ? forgeAiOpponentDeck : deck);
const targets = forgeAi ? [140] : [1, 4, 24, 60];
const request = {
  gameId: sessionId,
  variant: "Constructed",
  startingLife: forgeAi ? 1000 : 20,
  seed: 42,
  decisionJournal: true,
  journalRewind: true,
  snapshotRecording: false,
  players: [
    ...[0, 1].map((seat) => ({ name: `Player ${seat}`, ai: false, deck: humanDeck })),
    ...(forgeAi ? [{ name: "Forge AI", ai: true, deck: flatten(forgeAiDeck) }] : []),
  ],
  ...(forgeAi && { forgeAiPolicy: "deterministic-v1" }),
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function until(read, predicate) {
  const deadline = performance.now() + 120000;
  while (performance.now() < deadline) {
    const result = await read();
    if (predicate(result)) return result;
    await pause();
  }
  throw new Error("Rewind regression timed out");
}
async function view(engine) {
  return JSON.parse(await engine.call("getSnapshot", { viewer: 0 }));
}
function board(view) {
  const { checkpoints, restoreVote, decisionHistory, snapshotRecording, ...state } = view;
  return state;
}
async function directive(engine, player, directive) {
  await engine.call("submitAction", {
    payload: JSON.stringify({ type: "directive", player, directive }),
  });
}
async function requestRewind(engine, checkpointId) {
  await directive(engine, 0, { type: "requestRestore", checkpointId });
  const pending = await until(
    () => view(engine),
    (view) => view.restoreVote?.status.type === "pending",
  );
  assert.deepEqual(pending.restoreVote.awaitingPlayerIds, ["player-1"]);
  await directive(engine, 1, {
    type: "restoreVote",
    voteId: pending.restoreVote.voteId,
    accept: true,
  });
  return JSON.parse(await until(() => engine.call("getRewindRequest"), Boolean));
}

const source = harness(options);
try {
  await source.call("startGame", { payload: JSON.stringify(request) });
  const boundaries = [];
  let prompt = await source.prompt();
  for (let index = 0; index < (forgeAi ? 330 : 100); index++) {
    const state = await view(source);
    assert(state.decisionHistory);
    assert.equal(state.snapshotRecording, false);
    boundaries.push({ prompt, state: board(state), action: scriptedAnswer({ prompt }) });
    await source.call("submitAction", { payload: JSON.stringify(boundaries.at(-1).action) });
    prompt = await source.prompt(prompt.promptId);
  }
  const original = board(await view(source));
  if (forgeAi) {
    assert.deepEqual(forgeAiActivity(boundaries.slice(targets[0] - 1).map(({ state }) => state)), {
      targetedSpell: true,
      attack: true,
    });
  }
  for (const target of targets) {
    const snapshot = await requestRewind(source, target);
    const continuation = boundaries.slice(target - 1, forgeAi ? undefined : target + 7);
    const restored = harness(options);
    try {
      const start = JSON.parse(snapshot.journal.startRequest);
      await restored.call("startGame", {
        payload: JSON.stringify({ ...start, replaySnapshot: snapshot }),
      });
      await until(
        () => restored.call("replayReady"),
        (ready) => ready === "true",
      );
      const restoredView = await view(restored);
      assert.equal(restoredView.restoreVote.status.type, "approved");
      assert.equal(restoredView.checkpoints.length, target - 1);
      for (const boundary of continuation) {
        assert.deepEqual(
          JSON.parse(await restored.call("getPrompt", { playerIndex: 0 })),
          boundary.prompt,
        );
        assert.deepEqual(board(await view(restored)), boundary.state);
        await restored.call("submitAction", { payload: JSON.stringify(boundary.action) });
        await restored.prompt(boundary.prompt.promptId);
      }
      if (forgeAi) assert.deepEqual(board(await view(restored)), original);
      console.log(
        JSON.stringify({
          runtime: values.native ? "native" : "jvm",
          forgeAi: !!forgeAi,
          target,
          continued: continuation.length,
        }),
      );
    } finally {
      restored.close();
      await source.call("resumeAfterFailedRewind");
      await until(
        () => view(source),
        (view) => view.restoreVote?.status.type === "unavailable",
      );
      assert.deepEqual(board(await view(source)), original);
    }
  }
  const snapshot = await requestRewind(source, forgeAi ? targets[0] : 24);
  snapshot.verification.state = "corrupt";
  const rejected = harness(options);
  try {
    const start = JSON.parse(snapshot.journal.startRequest);
    await rejected.call("startGame", {
      payload: JSON.stringify({ ...start, replaySnapshot: snapshot }),
    });
    await assert.rejects(
      until(
        () => rejected.call("replayReady"),
        (ready) => ready === "true",
      ),
      /state\/RNG divergence/,
    );
  } finally {
    rejected.close();
  }
  await source.call("resumeAfterFailedRewind");
  await until(
    () => view(source),
    (view) => view.restoreVote?.status.type === "unavailable",
  );
  assert.deepEqual(board(await view(source)), original);
  await source.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  await source.prompt(prompt.promptId);
  console.log(JSON.stringify({ rejectedCorruptReplay: true, originalContinues: true }));
  await requestRewind(source, forgeAi ? targets[0] : 24);
  await directive(source, 0, { type: "concede" });
  assert.equal(await source.call("getRewindRequest"), "", "pending concede cancels promotion");
  if (forgeAi) {
    await until(
      () => view(source),
      (state) => state.players.find((player) => player.id === "player-0")?.status === "conceded",
    );
  } else {
    await until(
      () => source.call("getGameOver"),
      (over) => over === "true",
    );
  }
  console.log(JSON.stringify({ queuedConcedePreserved: true }));
} finally {
  source.close();
}
