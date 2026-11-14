import { exemptCards, type Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const grizzlegom: Rulebreaker = {
  name: "Grizzlegom, Hurloon Hero",
  rule: "A deck with this commander can have any land cards.",
  apply: exemptCards((card) => card.types.includes("Land")),
};
