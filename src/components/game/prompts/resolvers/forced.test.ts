import { describe, expect, it } from "vitest";

import { singleLegalAny, singleLegalCard, singleLegalPlayer } from "./forced";
import type { ResolveCtx } from "../promptHandlers";
import type { PromptRequest } from "@/protocol";
import type * as ChooseTargetAny from "@/protocol/prompts/chooseTargetAny";
import type * as ChooseTargetCard from "@/protocol/prompts/chooseTargetCard";
import type * as ChooseTargetPlayer from "@/protocol/prompts/chooseTargetPlayer";
import { TargetingIntent } from "@/types/promptType";

const ctx: ResolveCtx = {
  prefs: { show: {}, triggerMemory: {} },
  targetIntents: {},
};

function targetCardPrompt(input: Partial<ChooseTargetCard.Input>) {
  return {
    sourceCardId: "source",
    input: {
      type: "chooseTargetCard",
      validCardIds: ["card-1"],
      hostile: true,
      intent: TargetingIntent.Damage,
      minTargets: 1,
      maxTargets: 1,
      chosenTargets: 0,
      ...input,
    },
  } satisfies PromptRequest<ChooseTargetCard.Input>;
}

function targetPlayerPrompt(input: Partial<ChooseTargetPlayer.Input>) {
  return {
    sourceCardId: "source",
    input: {
      type: "chooseTargetPlayer",
      validPlayerIds: ["player-1"],
      hostile: true,
      intent: TargetingIntent.Damage,
      minTargets: 1,
      maxTargets: 1,
      chosenTargets: 0,
      ...input,
    },
  } satisfies PromptRequest<ChooseTargetPlayer.Input>;
}

function targetAnyPrompt(input: Partial<ChooseTargetAny.Input>) {
  return {
    sourceCardId: "source",
    input: {
      type: "chooseTargetAny",
      validPlayerIds: [],
      validCardIds: ["card-1"],
      hostile: true,
      intent: TargetingIntent.Damage,
      minTargets: 1,
      maxTargets: 1,
      chosenTargets: 0,
      ...input,
    },
  } satisfies PromptRequest<ChooseTargetAny.Input>;
}

describe("target prompt auto-resolution", () => {
  it("auto-selects a single required card target", () => {
    expect(singleLegalCard(targetCardPrompt({}), ctx).kind).toBe("auto");
  });

  it("does not auto-select a single optional card target", () => {
    expect(singleLegalCard(targetCardPrompt({ minTargets: 0 }), ctx).kind).toBe("force-show");
  });

  it("does not auto-select a single optional player target", () => {
    expect(singleLegalPlayer(targetPlayerPrompt({ minTargets: 0 }), ctx).kind).toBe("force-show");
  });

  it("does not auto-select a single optional mixed target", () => {
    expect(singleLegalAny(targetAnyPrompt({ minTargets: 0 }), ctx).kind).toBe("force-show");
  });
});
