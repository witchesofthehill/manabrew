import { execFileSync } from "node:child_process";

import { beforeAll, describe, expect, it } from "vitest";

import { PromptType } from "@/types/promptType";
import { applyPrompt, HANDLED_PROMPT_TYPES } from "./gameStore.constants";
import type { AgentPrompt, GameState } from "./gameStore.types";

// Corpus = one example of every AgentPromptInner variant, generated on demand by
// the rust emitter (no committed fixture, can't drift), replayed through applyPrompt.
let corpus: AgentPrompt[] = [];

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
    .map((line) => JSON.parse(line) as AgentPrompt);
}, 180_000);

const knownTypes = new Set<string>(Object.values(PromptType));

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

  it("declares every emitted prompt type in PromptType", () => {
    const unknown = [...new Set(corpus.map((p) => p.type as string))].filter(
      (type) => !knownTypes.has(type),
    );
    expect(unknown).toEqual([]);
  });

  it("handles every emitted type (in HANDLED_PROMPT_TYPES)", () => {
    const unhandled = [...new Set(corpus.map((p) => p.type as string))].filter(
      (type) => type !== PromptType.StateUpdate && !HANDLED_PROMPT_TYPES.has(type as PromptType),
    );
    expect(unhandled).toEqual([]);
  });

  it("ingests every prompt without throwing and routes decision prompts", () => {
    for (const prompt of corpus) {
      const decider = (prompt as { decidingPlayerId?: string }).decidingPlayerId ?? "player-0";
      const store = makeStoreStub(decider);
      expect(() => applyPrompt(prompt, "test", store.set, store.get), prompt.type).not.toThrow();
      if (prompt.type !== PromptType.StateUpdate) {
        expect(
          (store.get() as { currentPrompt: unknown }).currentPrompt,
          `${prompt.type} did not route to currentPrompt`,
        ).not.toBeNull();
      }
    }
  });
});
