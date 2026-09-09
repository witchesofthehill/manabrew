import { isToggledOff, type PromptResolver } from "./promptHandlers";

export const ackReveal: PromptResolver<"revealCards"> = (_prompt, ctx) => {
  if (!isToggledOff("revealCards", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "revealCardsAcknowledged" },
    reason: "RevealCards toggled off; auto-ack",
  };
};

export const ackDiceRolled: PromptResolver<"diceRolled"> = (_prompt, ctx) => {
  if (!isToggledOff("diceRolled", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "diceRolledAcknowledged" },
    reason: "DiceRolled toggled off; auto-ack",
  };
};
