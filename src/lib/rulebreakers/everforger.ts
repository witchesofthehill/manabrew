import { isBasicLand } from "@/lib/formats";
import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const everforger: Rulebreaker = {
  name: "The Everforger",
  rule: "A deck with this commander can have artifact creature and Equipment cards of any color identity and any basic land cards.",
  apply: exemptCards(
    (card) =>
      (card.types.includes("Artifact") && card.types.includes("Creature")) ||
      card.subtypes.includes("Equipment") ||
      isBasicLand(card),
  ),
};
