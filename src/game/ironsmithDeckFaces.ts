import type { Deck, DeckCard } from "@/protocol/deck";

// Scryfall layouts whose two parts share one image. Manabrew keeps only the
// front part of these (name, text) next to the card-level joined mana cost.
const SINGLE_IMAGE_TWO_PART_LAYOUTS = new Set(["split", "adventure", "prepare", "flip"]);

/** Whether Ironsmith needs both Scryfall `card_faces` to run this card whole. */
export function needsBothCardParts(card: DeckCard): boolean {
  return !!card.isDoubleFaced || SINGLE_IMAGE_TWO_PART_LAYOUTS.has(card.layout ?? "");
}

type CardPartsLookup = (card: DeckCard) => Promise<readonly unknown[] | undefined>;

async function withParts(cards: DeckCard[], lookup: CardPartsLookup): Promise<DeckCard[]> {
  return Promise.all(
    cards.map(async (card) => {
      if (!needsBothCardParts(card)) return card;
      try {
        const faces = await lookup(card);
        return faces && faces.length >= 2 ? { ...card, cardFaces: faces } : card;
      } catch {
        return card;
      }
    }),
  );
}

// Ironsmith builds a linked two-part definition only when a deck entry carries
// both parts. Without them a transform or modal double-faced card loads as its
// front face, and a split, adventure, prepare or flip card as its first half.
// A lookup that fails leaves the card as it was.
export async function withBothCardParts(deck: Deck, lookup: CardPartsLookup): Promise<Deck> {
  const [cards, sideboard, commanders, companion] = await Promise.all([
    withParts(deck.cards, lookup),
    deck.sideboard ? withParts(deck.sideboard, lookup) : deck.sideboard,
    deck.commanders ? withParts(deck.commanders, lookup) : deck.commanders,
    deck.companion ? withParts([deck.companion], lookup).then(([card]) => card) : deck.companion,
  ]);
  return { ...deck, cards, sideboard, commanders, companion };
}
