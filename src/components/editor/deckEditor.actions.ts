import type { DeckCard } from "@/protocol/deck";
import { useDeckStore } from "@/stores/useDeckStore";

export type EditableDeckZone = "main" | "side" | "maybe";
export type DeckSourceZone = EditableDeckZone | "special";

function zoneCards(zone: DeckSourceZone): DeckCard[] {
  const deck = useDeckStore.getState().currentDeck;
  if (zone === "main") return deck.cards;
  if (zone === "maybe") return deck.maybeboard ?? [];
  if (zone === "special") {
    return [
      ...(deck.attractions ?? []),
      ...(deck.contraptions ?? []),
      ...(deck.schemes ?? []),
      ...(deck.planes ?? []),
    ];
  }
  return deck.sideboard;
}

function removeCard(card: DeckCard, zone: DeckSourceZone) {
  const store = useDeckStore.getState();
  if (zone === "main") store.removeFromMain(card.identity.id);
  else if (zone === "side" || zone === "special") store.removeFromSide(card.identity.id);
  else store.removeFromMaybe(card.identity.id);
}

export function moveCardCopies(
  cardName: string,
  source: EditableDeckZone,
  destination: EditableDeckZone,
  quantity: "one" | "all",
): number {
  if (source === destination) return 0;
  const matches = zoneCards(source).filter(
    (card) => card.identity.name.toLowerCase() === cardName.toLowerCase(),
  );
  const cards = quantity === "one" ? matches.slice(-1) : matches;
  return useDeckStore.getState().moveCards(
    cards.map((card) => card.identity.id),
    destination,
  );
}

export function removeCardCopies(
  cardName: string,
  source: DeckSourceZone,
  quantity: "one" | "all",
): number {
  const matches = zoneCards(source).filter(
    (card) => card.identity.name.toLowerCase() === cardName.toLowerCase(),
  );
  const cards = quantity === "one" ? matches.slice(-1) : matches;
  for (const card of cards) removeCard(card, source);
  return cards.length;
}

export function moveSelectedCards(
  cardNames: Iterable<string>,
  destination: EditableDeckZone,
): number {
  const names = new Set([...cardNames].map((name) => name.toLowerCase()));
  const ids = (["main", "side", "maybe"] as const).flatMap((source) =>
    source === destination
      ? []
      : zoneCards(source)
          .filter((card) => names.has(card.identity.name.toLowerCase()))
          .map((card) => card.identity.id),
  );
  return useDeckStore.getState().moveCards(ids, destination);
}

export function removeSelectedCards(cardNames: Iterable<string>): number {
  const names = new Set([...cardNames].map((name) => name.toLowerCase()));
  let removed = 0;
  for (const zone of ["main", "side", "maybe", "special"] as const) {
    const cards = zoneCards(zone).filter((card) => names.has(card.identity.name.toLowerCase()));
    for (const card of cards) {
      removeCard(card, zone);
      removed += 1;
    }
  }
  return removed;
}
