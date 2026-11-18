import type { Prompt, PromptOutput } from "@/protocol";

// A bot decides from the prompt alone, so an answer the engine refused would
// be given again, forever. What the host remembers per bot seat to get it out.
export interface BotRecovery {
  refusedPromptId: number | null;
  cancelledPromptId: number | null;
  passNext: boolean;
}

export function newBotRecovery(): BotRecovery {
  return { refusedPromptId: null, cancelledPromptId: null, passNext: false };
}

/**
 * The answer to give in the bot's place, `"stalled"` when there is none, or
 * null to let the bot decide. A refused payment is cancelled, and the bot then
 * passes once instead of announcing the same spell or ability again.
 */
export function recoverBotAnswer(
  prompt: Prompt,
  recovery: BotRecovery,
): PromptOutput | "stalled" | null {
  const promptId = Number(prompt.promptId ?? 0);
  if (recovery.refusedPromptId === promptId) {
    if (prompt.input.type !== "payManaCost" || recovery.cancelledPromptId === promptId) {
      return "stalled";
    }
    recovery.cancelledPromptId = promptId;
    recovery.passNext = true;
    return { type: "payManaCost", output: { type: "cancel" } };
  }
  const pass = recovery.passNext && prompt.input.type === "chooseAction";
  recovery.passNext = false;
  return pass ? { type: "chooseAction", output: { type: "pass", exhaustStack: false } } : null;
}
