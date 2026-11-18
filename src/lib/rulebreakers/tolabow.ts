import { getCardIdentity, isBasicLand } from "@/lib/formats";
import type { Rulebreaker } from "@/lib/rulebreakers/rulebreaker";
import type { DeckCard } from "@/protocol/deck";

export const tolabow: Rulebreaker = {
  name: "Tolabow, Loch Rascal",
  rule: "If Tolabow, Loch Rascal is your commander, the color identity of instant and sorcery cards in your deck can include one color of your choice not in your commander's color identity, and your deck can have any basic land cards.",
  apply: (legality) => {
    const offIdentity = legality.offIdentityCards.filter((card) => !isBasicLand(card));
    const outsideColors = (card: DeckCard) =>
      getCardIdentity(card).filter((color) => !legality.commanderIdentity.has(color));
    const withChosenColor = (chosen: string) =>
      offIdentity.filter(
        (card) =>
          !(
            (card.types.includes("Instant") || card.types.includes("Sorcery")) &&
            outsideColors(card).every((color) => color === chosen)
          ),
      );
    const offIdentityCards = [...new Set(offIdentity.flatMap(outsideColors))]
      .map(withChosenColor)
      .reduce((best, cards) => (cards.length < best.length ? cards : best), offIdentity);
    return { ...legality, offIdentityCards };
  },
};
