import { isBasicLand } from "@/lib/formats";
import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const maular: Rulebreaker = {
  name: "Maular, the Next Evolution",
  rule: "A deck with this commander can have creature cards with mana value 7 or greater of any color identity and any basic land cards.",
  apply: exemptCards(
    (card) => (card.types.includes("Creature") && card.cmc >= 7) || isBasicLand(card),
  ),
};
