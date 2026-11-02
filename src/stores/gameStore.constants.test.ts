/// <reference types="node" />
import { execFileSync } from "node:child_process";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyPrompt, applySnapshot, applyState } from "./gameStore.constants";
import type { DeferredSnapshot, GameState } from "./gameStore.types";
import type { Prompt } from "@/protocol";
import type { GameViewDto } from "@/protocol/game";
import { playSound } from "@/lib/soundRuntime";

vi.mock("@/lib/soundRuntime", () => ({
  playSound: vi.fn(),
}));

// Corpus = one example of every AgentPromptInner variant, generated on demand by
// the rust emitter (no committed fixture, can't drift), replayed through applyPrompt.
let corpus: Prompt[] = [];

beforeAll(() => {
  const jsonl = execFileSync(
    "cargo",
    ["run", "-q", "-p", "manabrew-agent-interface", "--bin", "emit_prompt_fixtures"],
    { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  corpus = jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Prompt);
}, 180_000);

function makeStoreStub(myPlayerSlot: unknown) {
  let state: Record<string, unknown> = {
    gameView: null,
    deferredQueue: [],
    isFlashing: false,
    currentPrompt: null,
    isWaitingForResponse: false,
    myPlayerSlot,
  };
  return {
    set: (partial: Record<string, unknown>) => {
      state = { ...state, ...partial };
    },
    get: () => state as unknown as GameState,
  };
}

describe("UI message handling (engine -> store)", () => {
  it("emits a prompt for every variant", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("routes every prompt to currentPrompt without throwing", () => {
    for (const prompt of corpus) {
      const store = makeStoreStub("player-0");
      expect(
        () => applyPrompt(prompt, "test", store.set, store.get),
        prompt.input.type,
      ).not.toThrow();
      expect(
        (store.get() as { currentPrompt: unknown }).currentPrompt,
        `${prompt.input.type} did not route to currentPrompt`,
      ).not.toBeNull();
    }
  });

  it("prompts carry no game view", () => {
    for (const prompt of corpus) {
      expect((prompt.input as Record<string, unknown>).gameView).toBeUndefined();
    }
  });

  it("applyState is the sole carrier of game state", () => {
    const store = makeStoreStub("player-0");
    applyState({ gameId: "g" } as GameViewDto, "test", store.set, store.get);
    expect((store.get() as { gameView: unknown }).gameView).not.toBeNull();
    expect((store.get() as { currentPrompt: unknown }).currentPrompt).toBeNull();
  });

  it("a flashed state change enqueues behind its flash and never sets a prompt", () => {
    const store = makeStoreStub("player-0");
    applyState({ gameId: "g", turn: 1 } as GameViewDto, "test", store.set, store.get);
    applyState(
      { gameId: "g", turn: 2, activePlayerId: "player-0" } as GameViewDto,
      "test",
      store.set,
      store.get,
    );
    const s = store.get() as { deferredQueue: unknown[]; currentPrompt: unknown };
    expect(s.deferredQueue.length).toBe(1);
    expect(s.currentPrompt).toBeNull();
  });
});

describe("snapshot sounds", () => {
  beforeEach(() => {
    vi.mocked(playSound).mockClear();
  });

  it("notifies once for the local turn without repeating on a phase-only update", () => {
    const store = makeStoreStub("player-0");
    const snapshot: DeferredSnapshot = {
      gameView: null,
      prompt: null,
      transitions: [{ kind: "turnStart", playerId: "player-0" }],
    };

    applySnapshot(snapshot, store.set, store.get);

    expect(playSound).toHaveBeenCalledExactlyOnceWith("roomInvite");

    vi.mocked(playSound).mockClear();
    applySnapshot({ ...snapshot, transitions: [] }, store.set, store.get);

    expect(vi.mocked(playSound).mock.calls.flat()).toEqual([]);
  });

  it("does not notify for an opponent turn", () => {
    const store = makeStoreStub("player-0");
    const snapshot: DeferredSnapshot = {
      gameView: null,
      prompt: null,
      transitions: [{ kind: "turnStart", playerId: "player-1" }],
    };

    applySnapshot(snapshot, store.set, store.get);

    expect(vi.mocked(playSound).mock.calls.flat()).toEqual([]);
  });

  it("does not notify for an initial snapshot without transitions", () => {
    const store = makeStoreStub("player-0");
    const snapshot: DeferredSnapshot = {
      gameView: null,
      prompt: null,
      transitions: [],
    };

    applySnapshot(snapshot, store.set, store.get);

    expect(vi.mocked(playSound).mock.calls.flat()).toEqual([]);
  });

  it("does not enqueue or sound a turn start when a restore completes", () => {
    const store = makeStoreStub("player-0");
    const gameView = {
      gameId: "g",
      turn: 5,
      activePlayerId: "player-1",
      step: "untap",
      priorityPlayerId: "player-1",
      players: [],
      zones: [],
      stack: [],
      combatAssignments: [],
      gameOver: false,
      winnerId: null,
      monarchId: null,
      initiativeHolderId: null,
      dayTime: "neither",
      snapshotRecording: false,
      checkpoints: [],
      restoreVote: {
        voteId: 1,
        checkpoint: {
          checkpointId: 1,
          turn: 2,
          step: "untap",
          activePlayerId: "player-0",
          log: [],
        },
        requestedByPlayerId: "player-0",
        awaitingPlayerIds: ["player-1"],
        status: { type: "pending" },
      },
    } satisfies GameViewDto;
    applyState(gameView, "test", store.set, store.get);
    vi.mocked(playSound).mockClear();

    applyState(
      {
        ...gameView,
        turn: 2,
        activePlayerId: "player-0",
        restoreVote: {
          ...gameView.restoreVote,
          awaitingPlayerIds: [],
          status: { type: "approved" },
        },
      },
      "test",
      store.set,
      store.get,
    );

    expect(store.get().gameView?.turn).toBe(2);
    expect(store.get().deferredQueue).toEqual([]);
    expect(vi.mocked(playSound).mock.calls.flat()).toEqual([]);
  });
});
