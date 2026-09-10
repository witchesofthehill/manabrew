import { isToggledOff, type PromptResolver } from "./promptHandlers";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

export const ackReveal: PromptResolver<"revealCards"> = (_prompt, ctx) => {
  if (!isToggledOff("revealCards", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "revealCardsAcknowledged" },
    reason: i18n._(msg`RevealCards toggled off; auto-ack`),
  };
};

export const ackDiceRolled: PromptResolver<"diceRolled"> = (_prompt, ctx) => {
  if (!isToggledOff("diceRolled", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "diceRolledAcknowledged" },
    reason: i18n._(msg`DiceRolled toggled off; auto-ack`),
  };
};
