import { parseCollectionCardKey } from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";

export interface OwnedPrintingAssignment {
  cardId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  foil: boolean;
}

interface OwnedPrintingPool {
  name: string;
  setCode: string;
  collectorNumber: string;
  foil?: boolean;
  remaining: number;
}

function samePrinting(card: DeckCard, pool: OwnedPrintingPool): boolean {
  return (
    card.identity.setCode.toLowerCase() === pool.setCode &&
    card.identity.cardNumber.toLowerCase() === pool.collectorNumber &&
    (pool.foil === undefined || !!card.identity.foil === pool.foil)
  );
}

export function allocateOwnedPrintings(
  cards: DeckCard[],
  quantities: Record<string, number>,
): OwnedPrintingAssignment[] {
  const cardNames = new Set(cards.map((card) => card.identity.name.toLowerCase()));
  const pools = Object.entries(quantities).flatMap(([key, quantity]) => {
    const identity = parseCollectionCardKey(key);
    if (
      quantity <= 0 ||
      !identity.setCode ||
      !identity.collectorNumber ||
      !cardNames.has(identity.name.toLowerCase())
    ) {
      return [];
    }
    return [
      {
        name: identity.name.toLowerCase(),
        setCode: identity.setCode.toLowerCase(),
        collectorNumber: identity.collectorNumber.toLowerCase(),
        foil: identity.foil,
        remaining: quantity,
      },
    ];
  });
  const unmatched: DeckCard[] = [];

  for (const card of cards) {
    const pool =
      pools.find(
        (candidate) =>
          candidate.remaining > 0 &&
          candidate.name === card.identity.name.toLowerCase() &&
          candidate.foil === !!card.identity.foil &&
          samePrinting(card, candidate),
      ) ??
      pools.find(
        (candidate) =>
          candidate.remaining > 0 &&
          candidate.name === card.identity.name.toLowerCase() &&
          candidate.foil === undefined &&
          samePrinting(card, candidate),
      );
    if (pool) pool.remaining -= 1;
    else unmatched.push(card);
  }

  return unmatched.flatMap((card) => {
    const pool =
      pools.find(
        (candidate) =>
          candidate.remaining > 0 &&
          candidate.name === card.identity.name.toLowerCase() &&
          candidate.foil === !!card.identity.foil,
      ) ??
      pools.find(
        (candidate) =>
          candidate.remaining > 0 &&
          candidate.name === card.identity.name.toLowerCase() &&
          candidate.foil === undefined,
      ) ??
      pools.find(
        (candidate) =>
          candidate.remaining > 0 && candidate.name === card.identity.name.toLowerCase(),
      );
    if (!pool) return [];
    pool.remaining -= 1;
    const foil = pool.foil ?? !!card.identity.foil;
    if (samePrinting(card, { ...pool, foil })) return [];
    return [
      {
        cardId: card.identity.id,
        name: card.identity.name,
        setCode: pool.setCode,
        collectorNumber: pool.collectorNumber,
        foil,
      },
    ];
  });
}
