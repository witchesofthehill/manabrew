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

function addCard(card: DeckCard, zone: EditableDeckZone) {
  const store = useDeckStore.getState();
  const moved = { ...card, identity: { ...card.identity, id: crypto.randomUUID() } };
  if (zone === "main") store.addToMain(moved);
  else if (zone === "side") store.addToSide(moved);
  else store.addToMaybe(moved);
}

export function moveCardCopies(
  cardName: string,
  source: DeckSourceZone,
  destination: EditableDeckZone,
  quantity: "one" | "all",
): number {
  if (source === destination || (source === "special" && destination === "side")) return 0;
  const matches = zoneCards(source).filter(
    (card) => card.identity.name.toLowerCase() === cardName.toLowerCase(),
  );
  const cards = quantity === "one" ? matches.slice(-1) : matches;
  for (const card of cards) {
    removeCard(card, source);
    addCard(card, destination);
  }
  return cards.length;
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
  let moved = 0;
  for (const source of ["main", "side", "maybe", "special"] as const) {
    if (source === destination || (source === "special" && destination === "side")) continue;
    const cards = zoneCards(source).filter((card) => names.has(card.identity.name.toLowerCase()));
    for (const card of cards) {
      removeCard(card, source);
      addCard(card, destination);
      moved += 1;
    }
  }
  return moved;
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
