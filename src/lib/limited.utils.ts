import { useMemo } from "react";

import type { DraftCard, LimitedDeck, SealedPool } from "@/types/limited";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";
import { frontFaceName, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { cardKey, useCard, useScryfallStore } from "@/stores/useScryfallStore";
export function manaPipPattern(letter: string): RegExp {
  return new RegExp(`\\{[^}]*${letter}[^}]*\\}`, "g");
}

export function countManaPips(cost: string, letter: string): number {
  return cost.match(manaPipPattern(letter))?.length ?? 0;
}

export function deckCardToDraftCard(card: DeckCard): DraftCard {
  const { name, setCode, cardNumber, foil } = card.identity;
  return {
    id: card.identity.id,
    name,
    setCode,
    cardNumber,
    foil,
  };
}

export function deckMainAsDraftCards(deck: Deck): DraftCard[] {
  return deck.cards.map(deckCardToDraftCard);
}

export function refToDeckCard(
  ref: DraftCard,
  entry: { info: ScryfallCard; uris: NonNullable<ScryfallCard["image_uris"]> },
): DeckCard {
  const card = scryfallToDeckCard({
    ...entry.info,
    image_uris: entry.info.image_uris ?? entry.uris,
  });
  return {
    ...card,
    uris: entry.uris,
    identity: {
      ...card.identity,
      id: ref.id,
      name: frontFaceName(ref.name),
      setCode: ref.setCode || card.identity.setCode,
      cardNumber: ref.setCode ? ref.cardNumber : card.identity.cardNumber,
      foil: ref.foil,
    },
  };
}

export async function resolveDeckCards(refs: DraftCard[]): Promise<DeckCard[]> {
  const store = useScryfallStore.getState();
  return Promise.all(
    refs.map(async (ref) => {
      const lookup = { name: ref.name, setCode: ref.setCode, cardNumber: ref.cardNumber };
      const key = cardKey(lookup);
      let entry = store.cards[key]?.card ?? null;
      if (!entry) {
        entry = await store.getCard(lookup);
      }
      if (!entry) throw new Error(`Card details are unavailable for ${ref.name}.`);
      return refToDeckCard(ref, entry);
    }),
  );
}

export function useDeckCard(ref: DraftCard): DeckCard | null {
  const entry = useCard({
    name: ref.name,
    setCode: ref.setCode,
    cardNumber: ref.cardNumber,
  });
  return useMemo(() => (entry ? refToDeckCard(ref, entry) : null), [entry, ref]);
}

export const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"] as const;
export type BasicLandName = (typeof BASIC_LAND_NAMES)[number];

const WUBRG = ["W", "U", "B", "R", "G"] as const;
export type ManaLetter = (typeof WUBRG)[number];

export const BASIC_LAND_MANA: Record<BasicLandName, ManaLetter> = Object.fromEntries(
  BASIC_LAND_NAMES.map((name, i) => [name, WUBRG[i]]),
) as Record<BasicLandName, ManaLetter>;

export async function resolveBasicLand(name: BasicLandName): Promise<DraftCard> {
  const entry = await useScryfallStore.getState().getCard({ name });
  if (!entry) throw new Error(`Card details are unavailable for ${name}.`);
  return {
    id: crypto.randomUUID(),
    name,
    setCode: entry.info.set,
    cardNumber: entry.info.collector_number,
    foil: false,
  };
}

export async function resolveSealedPool(pool: SealedPool): Promise<SealedPool> {
  const resolveBasic = async (card: DraftCard): Promise<DraftCard> => {
    if (card.setCode || !BASIC_LAND_NAMES.some((name) => name === card.name)) return card;
    const entry = await useScryfallStore.getState().getCard({ name: card.name });
    return {
      ...card,
      setCode: entry.info.set,
      cardNumber: entry.info.collector_number,
      foil: false,
    };
  };
  const resolveDeck = async (deck: LimitedDeck): Promise<LimitedDeck> => {
    const [main, sideboard] = await Promise.all([
      Promise.all(deck.main.map(resolveBasic)),
      Promise.all(deck.sideboard.map(resolveBasic)),
    ]);
    return { ...deck, main, sideboard };
  };
  const [suggestedDeck, aiDecks] = await Promise.all([
    pool.suggestedDeck ? resolveDeck(pool.suggestedDeck) : null,
    Promise.all(pool.aiDecks.map(resolveDeck)),
  ]);
  return { ...pool, suggestedDeck, aiDecks };
}

export function isSynthBasic(card: DraftCard): boolean {
  return card.setCode === "" && card.cardNumber.startsWith("basic-");
}
