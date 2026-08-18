import { DEFAULT_DECK_NAME, DEFAULT_IMPORT_NAME } from "@/lib/deckNames.constants";
import type { Deck, DeckCard } from "@/protocol/deck";

export function resolveDeckName(name: string, commanders?: DeckCard[]): string {
  if (name !== DEFAULT_DECK_NAME && name !== DEFAULT_IMPORT_NAME) return name;
  const commanderName = commanders?.map((card) => card.identity.name).join(" / ");
  return commanderName || name;
}

export function withResolvedDeckName<T extends Deck>(deck: T): T {
  const name = resolveDeckName(deck.name, deck.commanders);
  return name === deck.name ? deck : { ...deck, name };
}
