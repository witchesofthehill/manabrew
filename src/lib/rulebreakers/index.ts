import { arvad } from "@/lib/rulebreakers/arvad";
import { daxiver } from "@/lib/rulebreakers/daxiver";
import { everforger } from "@/lib/rulebreakers/everforger";
import { grizzlegom } from "@/lib/rulebreakers/grizzlegom";
import { hadran } from "@/lib/rulebreakers/hadran";
import { maular } from "@/lib/rulebreakers/maular";
import type { Rulebreaker } from "@/lib/rulebreakers/rulebreaker";
import { seluma } from "@/lib/rulebreakers/seluma";
import { tolabow } from "@/lib/rulebreakers/tolabow";
import { unluckiestPlaneswalker } from "@/lib/rulebreakers/unluckiestPlaneswalker";
import { valkoIndorian } from "@/lib/rulebreakers/valkoIndorian";
import { valkoIndorianResearcher } from "@/lib/rulebreakers/valkoIndorianResearcher";
import { whtz } from "@/lib/rulebreakers/whtz";
import type { DeckCard } from "@/protocol/deck";

const RULEBREAKERS = new Map(
  [
    arvad,
    daxiver,
    everforger,
    grizzlegom,
    hadran,
    maular,
    seluma,
    tolabow,
    unluckiestPlaneswalker,
    valkoIndorian,
    valkoIndorianResearcher,
    whtz,
  ].map((rulebreaker) => [rulebreaker.name, rulebreaker]),
);

export function commanderRulebreakers(commanders: DeckCard[]): Rulebreaker[] {
  return commanders.flatMap((card) => RULEBREAKERS.get(card.identity.name) ?? []);
}
