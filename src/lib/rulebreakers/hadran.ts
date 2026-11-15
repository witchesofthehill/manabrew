import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const hadran: Rulebreaker = {
  name: "Hadran, Naya Sunseeder",
  rule: "If Hadran, Naya Sunseeder is your Commander, you may include creature cards of power 4 or greater of any color in your deck regardless of color identity.",
  apply: exemptCards((card) => card.types.includes("Creature") && Number(card.power) >= 4),
};
