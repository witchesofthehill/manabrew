import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { harness } from "./journal-harness.mjs";
import { scriptedAnswer } from "./journal-fixture.mjs";

const { values } = parseArgs({
  options: {
    jar: {
      type: "string",
      default: "forge-harness/target/forge-harness-jar-with-dependencies.jar",
    },
    "forge-home": { type: "string", default: "forge/forge-gui" },
    java: { type: "string", default: "java" },
    repeats: { type: "string", default: "2" },
    scenario: { type: "string" },
  },
});
const repeats = Number(values.repeats);
assert(Number.isSafeInteger(repeats) && repeats > 0);
async function assertContinuation(restored, entries) {
  for (const entry of entries) {
    await restored.call("submitAction", { payload: JSON.stringify(entry.action) });
    const deadline = performance.now() + 30_000;
    let batch;
    do {
      batch = JSON.parse((await restored.call("readDecisionJournal")) || "null");
      if (batch?.entries.length) break;
      assert(performance.now() < deadline, "continuation did not consume its input");
      await new Promise((resolve) => setTimeout(resolve, 2));
    } while (true);
    assert.deepEqual(batch.entries, [entry], `continuation ${entry.sequence}`);
    await restored.call("acknowledgeDecisionJournal", { sequence: entry.sequence });
  }
}

const scenarios = [
  {
    name: "constructed",
    seats: 2,
    variant: "Constructed",
    decisions: 180,
    cards: [
      ["Forest", 20],
      ["Memnite", 20],
      ["Sprout", 20],
    ],
  },
  {
    name: "hidden-random",
    seats: 2,
    variant: "Constructed",
    decisions: 300,
    cards: [
      ["Island", 20],
      ["Ponder", 12],
      ["Brainstorm", 12],
      ["Memnite", 8],
      ["Stern Dismissal", 8],
    ],
  },
  {
    name: "commander-triggers",
    seats: 4,
    variant: "Commander",
    decisions: 400,
    commander: "Isamaru, Hound of Konda",
    cards: [
      ["Plains", 35],
      ["Soul Warden", 20],
      ["Memnite", 24],
      ["Raise the Alarm", 20],
    ],
  },
  {
    name: "stack-responses",
    seats: 2,
    variant: "Constructed",
    decisions: 320,
    cards: [
      ["Island", 20],
      ["Memnite", 8],
      ["Opt", 12],
      ["Counterspell", 12],
      ["Brainstorm", 8],
    ],
  },
  {
    name: "random-coins",
    seats: 2,
    variant: "Constructed",
    decisions: 180,
    life: 100,
    cards: [
      ["Mountain", 20],
      ["Mana Clash", 20],
      ["Memnite", 20],
    ],
  },
  {
    name: "long-game",
    seats: 2,
    variant: "Constructed",
    decisions: 1000,
    cards: [
      ["Forest", 80],
      ["Memnite", 20],
    ],
  },
];
const results = [];
for (const scenario of scenarios.filter((s) => !values.scenario || s.name === values.scenario)) {
  const sessionId = `replay-${scenario.name}`;
  const engine = (javaOptions = []) =>
    harness({
      javaOptions,
      java: values.java,
      jar: values.jar,
      forgeHome: values["forge-home"],
      sessionId,
    });
  const request = {
    gameId: sessionId,
    variant: scenario.variant,
    startingLife: scenario.life ?? (scenario.seats === 4 ? 40 : 20),
    seed: 43,
    snapshotRecording: false,
    decisionJournal: true,
    players: Array.from({ length: scenario.seats }, (_, seat) => ({
      name: `Player ${seat}`,
      ai: false,
      commanderNames: scenario.commander ? [scenario.commander] : [],
      deck: [...(scenario.commander ? [[scenario.commander, 1]] : []), ...scenario.cards].flatMap(
        ([name, count]) => Array.from({ length: count }, () => ({ name })),
      ),
    })),
  };
  const source = engine();
  const entries = [],
    snapshots = [],
    promptTypes = new Set();
  let history,
    maxTurn = 0,
    maxStack = 0,
    maxLife = 0,
    minLife = request.startingLife,
    stackBoundary = false;
  const decidingSeats = new Set();
  let hiddenBoundary = false,
    nestedBoundary = false;
  const capture = async (label) => {
    const snapshot = await source.call("exportReplaySnapshot", {
      payload: JSON.stringify(history),
    });
    snapshots.push({ label, sequence: entries.length, snapshot });
  };
  try {
    await source.call("startGame", { payload: JSON.stringify(request) });
    let prompt = await source.prompt();
    const initialView = JSON.parse(await source.call("getSnapshot", { viewer: 0 }));
    assert(
      initialView.players.every((player) => player.life === request.startingLife),
      "honor requested initial life",
    );
    const manifest = await source.drain();
    history = { version: manifest.version, startRequest: manifest.startRequest, entries };
    await capture("initial");
    for (let i = 0; i < scenario.decisions + 12; i++) {
      promptTypes.add(prompt.input.type);
      if (prompt.decidingPlayerId) decidingSeats.add(prompt.decidingPlayerId);
      const view = JSON.parse(await source.call("getSnapshot", { viewer: 0 }));
      maxTurn = Math.max(maxTurn, Number(view.turn ?? 0));
      maxStack = Math.max(maxStack, view.stack?.length ?? 0);
      for (const player of view.players) {
        maxLife = Math.max(maxLife, player.life);
        minLife = Math.min(minLife, player.life);
      }
      if (!hiddenBoundary && ["chooseCards", "reorder", "scry"].includes(prompt.input.type)) {
        await capture("hidden-choice");
        hiddenBoundary = true;
      }
      if (!nestedBoundary && (view.stack?.length ?? 0) > 1) {
        await capture("nested-stack");
        nestedBoundary = true;
      }
      if (!stackBoundary && (view.stack?.length ?? 0) > 0 && entries.length > 20) {
        await capture("nonempty-stack");
        stackBoundary = true;
      }
      const action =
        i === 9
          ? {
              type: "directive",
              player: -1,
              directive: { type: "setSnapshotRecording", enabled: false },
            }
          : scriptedAnswer({ prompt });
      await source.call("submitAction", { payload: JSON.stringify(action) });
      if (action.type !== "directive") prompt = await source.prompt(prompt.promptId);
      const batch = await source.consumed();
      assert.equal(batch.unavailableReason, undefined);
      assert.equal(batch.entries.length, 1);
      entries.push(batch.entries[0]);
      if (i === 9) await capture("directive");
      if (i === scenario.decisions - 1) await capture("late");
    }
  } finally {
    source.close(); // SIGKILL: reconstruction cannot use any source-engine memory.
  }
  assert(entries.length === scenario.decisions + 12);
  assert.equal(decidingSeats.size, scenario.seats, "all seats must make decisions");
  if (scenario.name === "hidden-random") {
    assert(
      hiddenBoundary && promptTypes.has("chooseBoolean"),
      "exercise library choices and shuffle",
    );
  }
  if (scenario.name === "commander-triggers") {
    assert(
      maxLife > 40 && maxStack > 1,
      "exercise life-gain triggers and simultaneous stack entries",
    );
  }
  if (scenario.name === "stack-responses")
    assert(maxStack > 1 && promptTypes.has("chooseBoardTargets"));
  if (scenario.name === "random-coins")
    assert(minLife < request.startingLife, "coin flips must resolve");
  if (scenario.name === "long-game") assert(maxTurn >= 40);
  const timings = [];
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const saved of snapshots) {
      const restored = engine(
        repeat % 2 ? ["-XX:+UnlockExperimentalVMOptions", "-XX:hashCode=0"] : [],
      );
      const started = performance.now();
      try {
        await restored.call("restoreReplaySnapshot", { payload: saved.snapshot });
        timings.push({
          boundary: saved.label,
          sequence: saved.sequence,
          ms: Math.round(performance.now() - started),
        });
        await assertContinuation(restored, entries.slice(saved.sequence, saved.sequence + 12));
      } finally {
        restored.close();
      }
    }
  }
  if (scenario.name === "constructed") {
    const gated = engine();
    const gatedSnapshot = JSON.parse(snapshots.at(-1).snapshot);
    const gatedStart = JSON.parse(gatedSnapshot.journal.startRequest);
    gatedStart.decisionJournalCommitBarrier = true;
    gatedSnapshot.journal.startRequest = JSON.stringify(gatedStart);
    try {
      const started = performance.now();
      await gated.call("restoreReplaySnapshot", { payload: JSON.stringify(gatedSnapshot) });
      timings.push({
        boundary: "commit-barrier",
        sequence: gatedSnapshot.nextSequence - 1,
        ms: Math.round(performance.now() - started),
      });
      await assertContinuation(
        gated,
        entries.slice(gatedSnapshot.nextSequence - 1, gatedSnapshot.nextSequence + 11),
      );
    } finally {
      gated.close();
    }
    for (const [kind, mutate, expected] of [
      [
        "prompt",
        (s) => {
          s.journal.entries[3].prompt.promptId = 999999;
        },
        /prompt divergence at decision 4/,
      ],
      [
        "hidden-state",
        (s) => {
          s.journal.entries[3].verification.state = "changed";
        },
        /state\/RNG divergence at decision 4/,
      ],
      [
        "rng",
        (s) => {
          s.journal.entries[3].verification.rng = "changed";
        },
        /state\/RNG divergence at decision 4/,
      ],
      [
        "seed",
        (s) => {
          const start = JSON.parse(s.journal.startRequest);
          start.seed = 44;
          s.journal.startRequest = JSON.stringify(start);
        },
        /divergence at decision 1/,
      ],
      [
        "terminal",
        (s) => {
          s.verification.state = "changed";
        },
        /terminal state\/RNG divergence/,
      ],
      [
        "sequence",
        (s) => {
          s.journal.entries[3].sequence = 8;
        },
        /invalid journal entry/,
      ],
      [
        "boundary",
        (s) => {
          s.nextSequence++;
        },
        /snapshot boundary does not match journal length/,
      ],
      [
        "artifact",
        (s) => {
          s.identity = "changed";
        },
        /identity mismatch/,
      ],
    ]) {
      const restored = engine();
      try {
        const altered = JSON.parse(snapshots.at(-1).snapshot);
        mutate(altered);
        await assert.rejects(
          restored.call("restoreReplaySnapshot", { payload: JSON.stringify(altered) }),
          expected,
          kind,
        );
        await assert.rejects(restored.call("getPrompt", { playerIndex: 0 }), /unknown sessionId/);
      } finally {
        restored.close();
      }
    }
  }
  results.push({
    scenario: scenario.name,
    decisions: entries.length,
    maxTurn,
    maxStack,
    maxLife,
    minLife,
    stackBoundary,
    promptTypes: [...promptTypes],
    journalBytes: Buffer.byteLength(JSON.stringify(history)),
    timings,
  });
  console.log(JSON.stringify(results.at(-1)));
}
assert(results.length, "unknown scenario");
