import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const valkoIndorianResearcher: Rulebreaker = {
  name: "Valko Indorian, Researcher",
  rule: "If Valko Indorian, Researcher is your Commander, you may include all artifacts and enchantments in your deck regardless of color identity.",
  apply: exemptCards(
    (card) => card.types.includes("Artifact") || card.types.includes("Enchantment"),
  ),
};
