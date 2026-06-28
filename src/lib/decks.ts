import type { CardDto } from "@/protocol/game";
import type { Deck, DeckCard } from "@/protocol/deck";
import { peekArchivedToken } from "@/stores/useScryfallStore";

function normalizeTokenName(name: string): string {
  return name.toLowerCase().replace(/\s+token$/i, "");
}

export function asDeckCard(deck: Deck | undefined, gameCard: CardDto): DeckCard {
  const { name, setCode, cardNumber, isToken } = gameCard.identity;
  const pool = deck ? getDeckCardPool(deck) : [];
  const exact = pool.find(
    (c) =>
      c.identity.name === name &&
      c.identity.setCode === setCode &&
      c.identity.cardNumber === cardNumber,
  );
  if (exact) return exact;
  if (isToken) {
    const target = normalizeTokenName(name);
    const byName = pool.find(
      (c) => c.identity.name === name || normalizeTokenName(c.identity.name) === target,
    );
    if (byName) return byName;
    const token = peekArchivedToken({ name, setCode, cardNumber });
    if (token) return token;
    // Not a real token: a copy of a nontoken card (e.g. Prepare's copied
    // spell, Spark Double) is flagged isToken but keeps the source card's
    // identity, so it resolves by name via Scryfall like any other card.
  }
  // Mirrors the engine's `get_by_card_name`, which splits on " // ".
  const matchesName = (deckName: string) =>
    deckName === name || deckName.split(" // ").includes(name);
  const byName = pool.find((c) => matchesName(c.identity.name));
  if (byName) return byName;
  console.warn(
    `asDeckCard: no deck match for "${name}" (${setCode}#${cardNumber}), rendering by name`,
  );
  return {
    identity: { id: "", name, setCode, cardNumber },
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
  return [...deck.cards, ...(deck.commanders ?? [])].map((c) => c.identity.name);
}

export function getDeckFingerprint(deck: Deck): string {
  const tag = (section: string, list: DeckCard[]) =>
    list.map((c) => `${section}:${c.identity.name}:${c.identity.setCode}`);
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
    commander: deck.commanders?.[0]?.identity.name ?? null,
    cards: serialized,
  });
}
