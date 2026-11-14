import type { Rulebreaker } from "@/lib/rulebreakers/rulebreaker";

export const whtz: Rulebreaker = {
  name: "Whtz, the Bibliophile",
  rule: "A deck with this commander has no maximum deck size.",
  apply: (legality) => ({ ...legality, maxDeckSize: null }),
};
