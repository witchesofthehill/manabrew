import { isBasicLand } from "@/lib/formats";
import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const unluckiestPlaneswalker: Rulebreaker = {
  name: "The Unluckiest Planeswalker",
  rule: "A deck with this commander can have Aura cards of any color identity and any basic land cards.",
  apply: exemptCards((card) => card.subtypes.includes("Aura") || isBasicLand(card)),
};
