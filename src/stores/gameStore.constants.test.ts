import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { applyDisplay, applyPrompt, applyState } from "./gameStore.constants";
import type { GameState } from "./gameStore.types";
import type { Prompt } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";
import type { GameView } from "@/types/manabrew";

// Corpus = one example of every AgentPromptInner variant, generated on demand by
// the rust emitter (no committed fixture, can't drift), replayed through applyPrompt.
let corpus: Prompt[] = [];

beforeAll(() => {
  const jsonl = execFileSync(
    "cargo",
    ["run", "-q", "-p", "forge-agent-interface", "--bin", "emit_prompt_fixtures"],
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
    gameLog: [],
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
    applyState({ gameId: "g" } as GameView, "test", store.set, store.get);
    expect((store.get() as { gameView: unknown }).gameView).not.toBeNull();
    expect((store.get() as { currentPrompt: unknown }).currentPrompt).toBeNull();
  });

  it("applyDisplay enqueues an animation and never sets a prompt", () => {
    const store = makeStoreStub("player-0");
    applyDisplay({ kind: "cardPlayed" } as DisplayEvent, "test", store.set, store.get);
    const s = store.get() as { deferredQueue: unknown[]; currentPrompt: unknown };
    expect(s.deferredQueue.length).toBe(1);
    expect(s.currentPrompt).toBeNull();
  });
});
