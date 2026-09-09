import { isToggledOff, type PromptResolver } from "./promptHandlers";

export const ackReveal: PromptResolver<"revealCards"> = (_prompt, ctx) => {
  if (!isToggledOff("revealCards", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "revealCardsAcknowledged" },
    reason: "RevealCards toggled off; auto-ack",
  };
};

export const ackCoinFlipped: PromptResolver<"coinFlipped"> = (_prompt, ctx) => {
  if (!isToggledOff("coinFlipped", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "coinFlippedAcknowledged" },
    reason: "CoinFlipped toggled off; auto-ack",
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
export const ackPlanarDieRolled: PromptResolver<"planarDieRolled"> = (_prompt, ctx) => {
  if (!isToggledOff("planarDieRolled", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "planarDieRolledAcknowledged" },
    reason: "PlanarDieRolled toggled off; auto-ack",
  };
};
