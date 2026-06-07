import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { applyPrompt } from "./gameStore.constants";
import type { GameState } from "./gameStore.types";
import type { Prompt } from "@/protocol";

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

describe("UI prompt handling (engine -> applyPrompt)", () => {
  it("emits a prompt for every variant", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  it("ingests every prompt without throwing and routes decision prompts", () => {
    for (const prompt of corpus) {
      const decider = (prompt as { decidingPlayerId?: string }).decidingPlayerId ?? "player-0";
      const store = makeStoreStub(decider);
      expect(
        () => applyPrompt(prompt, "test", store.set, store.get),
        prompt.input.type,
      ).not.toThrow();
      if (prompt.input.type !== "stateUpdate") {
        expect(
          (store.get() as { currentPrompt: unknown }).currentPrompt,
          `${prompt.input.type} did not route to currentPrompt`,
        ).not.toBeNull();
      }
    }
  });
});
