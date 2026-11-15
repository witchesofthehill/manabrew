import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const daxiver: Rulebreaker = {
  name: "Daxiver, Izzet Electromancer",
  rule: "If Daxiver, Izzet Electromancer is your Commander, you may include instant and sorcery cards of any color in your deck regardless of color identity.",
  apply: exemptCards((card) => card.types.includes("Instant") || card.types.includes("Sorcery")),
};
