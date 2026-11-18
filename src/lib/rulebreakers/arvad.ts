import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

const PERMANENT_TYPES = ["Artifact", "Battle", "Creature", "Enchantment", "Land", "Planeswalker"];

export const arvad: Rulebreaker = {
  name: "Arvad of the Weatherlight",
  rule: "If Arvad of the Weatherlight is your Commander, you may include legendary permanents of any color in your deck regardless of color identity.",
  apply: exemptCards(
    (card) =>
      card.supertypes.includes("Legendary") &&
      card.types.some((type) => PERMANENT_TYPES.includes(type)),
  ),
};
