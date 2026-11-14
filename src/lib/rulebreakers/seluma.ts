import { isBasicLand } from "@/lib/formats";
import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const seluma: Rulebreaker = {
  name: "Seluma, Light of Aysen",
  rule: "A deck with this commander can have Angel cards of any color identity and any basic land cards.",
  apply: exemptCards((card) => card.subtypes.includes("Angel") || isBasicLand(card)),
};
