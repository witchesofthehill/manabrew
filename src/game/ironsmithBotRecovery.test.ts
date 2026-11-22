import { describe, expect, it } from "vitest";
import type { Prompt } from "@/protocol";
import { newBotRecovery, recoverBotAnswer } from "./ironsmithBotRecovery";

const prompt = (promptId: number, type: string) =>
  ({ promptId, input: { type } }) as unknown as Prompt;

describe("Ironsmith bot recovery", () => {
  it("lets the bot decide while nothing was refused", () => {
    const recovery = newBotRecovery();
    expect(recoverBotAnswer(prompt(1, "chooseAction"), recovery)).toBeNull();
    expect(recoverBotAnswer(prompt(2, "payManaCost"), recovery)).toBeNull();
  });

  it("cancels a refused payment, then passes once", () => {
    const recovery = newBotRecovery();
    recovery.refusedPromptId = 2;
    expect(recoverBotAnswer(prompt(2, "payManaCost"), recovery)).toEqual({
      type: "payManaCost",
      output: { type: "cancel" },
    });
    expect(recoverBotAnswer(prompt(3, "chooseAction"), recovery)).toEqual({
      type: "chooseAction",
      output: { type: "pass", exhaustStack: false },
    });
    expect(recoverBotAnswer(prompt(4, "chooseAction"), recovery)).toBeNull();
  });

  it("stalls instead of repeating an answer it cannot replace", () => {
    const recovery = newBotRecovery();
    recovery.refusedPromptId = 5;
    expect(recoverBotAnswer(prompt(5, "chooseBoardTargets"), recovery)).toBe("stalled");
    recovery.refusedPromptId = 6;
    expect(recoverBotAnswer(prompt(6, "payManaCost"), recovery)).not.toBe("stalled");
    // The cancel itself was refused.
    expect(recoverBotAnswer(prompt(6, "payManaCost"), recovery)).toBe("stalled");
  });
});
