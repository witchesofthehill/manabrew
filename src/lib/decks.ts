import type { Deck, DeckCard, GameCard } from "@/types/manabrew";
import { peekArchivedToken } from "@/stores/useScryfallStore";

function normalizeTokenName(name: string): string {
  return name.toLowerCase().replace(/\s+token$/i, "");
}

export function asDeckCard(deck: Deck | undefined, gameCard: GameCard): DeckCard {
  const pool = deck ? getDeckCardPool(deck) : [];
  const exact = pool.find(
    (c) =>
      c.name === gameCard.name &&
      c.setCode === gameCard.setCode &&
      c.cardNumber === gameCard.cardNumber,
  );
  if (exact) return exact;
  if (gameCard.isToken) {
    const target = normalizeTokenName(gameCard.name);
    const byName = pool.find(
      (c) => c.name === gameCard.name || normalizeTokenName(c.name) === target,
    );
    if (byName) return byName;
    const token = peekArchivedToken({
      name: gameCard.name,
      setCode: gameCard.setCode,
      cardNumber: gameCard.cardNumber,
    });
    if (token) return token;
    throw new Error(
      `Token archive has no entry for ${gameCard.name} (${gameCard.setCode}#${gameCard.cardNumber})`,
    );
  }
  // Match either face, mirroring the engine's own `get_by_card_name` which splits on " // ".
  const matchesName = (deckName: string) =>
    deckName === gameCard.name || deckName.split(" // ").includes(gameCard.name);
  const byName = pool.find((c) => matchesName(c.name));
  if (byName) return byName;
  console.warn(
    `asDeckCard: no deck match for "${gameCard.name}" (${gameCard.setCode}#${gameCard.cardNumber}), rendering by name`,
  );
  return {
    name: gameCard.name,
    setCode: gameCard.setCode,
    cardNumber: gameCard.cardNumber,
    // `uris` must be present — renderers index `deckCard.uris[resolution]` directly.
    uris: {},
  } as DeckCard;
}

export function getDeckCardPool(deck: Deck): DeckCard[] {
  return [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.commanders ?? []),
    ...(deck.tokens ?? []),
  ];
}

function getTokenSourceCards(deck: Deck): DeckCard[] {
  return [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.commanders ?? []),
    ...(deck.companion ? [deck.companion] : []),
    ...(deck.maybeboard ?? []),
  ];
}

export function collectAllPartsNames(deck: Deck): Set<string> {
  const out = new Set<string>();
  for (const card of getTokenSourceCards(deck)) {
    for (const part of card.allParts ?? []) {
      if (part.component !== "token") continue;
      out.add(part.name.toLowerCase());
    }
  }
  return out;
}

export function deriveTokens(deck: Deck): DeckCard[] {
  const seen = new Set<string>();
  const out: DeckCard[] = [];
  for (const card of getTokenSourceCards(deck)) {
    for (const part of card.allParts ?? []) {
      if (part.component !== "token") continue;
      const key = part.name.toLowerCase();
      if (seen.has(key)) continue;
      const token = peekArchivedToken({ name: part.name });
      if (!token) continue;
      seen.add(key);
      out.push(token);
    }
  }
  return out;
}

export function getDeckCardNames(deck: Deck): string[] {
  return [...deck.cards, ...(deck.commanders ?? [])].map((c) => c.name);
}

export function getDeckFingerprint(deck: Deck): string {
  const tag = (section: string, list: DeckCard[]) =>
    list.map((c) => `${section}:${c.name}:${c.setCode}`);
  const serialized = [
    ...tag("main", deck.cards),
    ...tag("sideboard", deck.sideboard),
    ...tag("attractions", deck.attractions ?? []),
    ...tag("contraptions", deck.contraptions ?? []),
    ...tag("schemes", deck.schemes ?? []),
    ...tag("planes", deck.planes ?? []),
    ...tag("commander", deck.commanders ?? []),
  ].sort();
  return JSON.stringify({
    name: deck.name,
    format: deck.format ?? "standard",
    commander: deck.commanders?.[0]?.name ?? null,
    cards: serialized,
  });
}
