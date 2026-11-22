import { isBasicLand } from "@/lib/formats";
import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const valkoIndorian: Rulebreaker = {
  name: "Valko Indorian",
  rule: "A deck with this commander can have Phyrexian cards of any color identity and any basic land cards.",
  apply: exemptCards((card) => card.subtypes.includes("Phyrexian") || isBasicLand(card)),
};
