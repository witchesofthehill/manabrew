import type { Deck, DeckCard, GameCard } from "@/types/manabrew";
import { peekArchivedToken } from "@/stores/useScryfallStore";

/** Engine emits token names with a "Token" suffix ("Map Token", "Blood
 *  Token"); Scryfall (and so the archive + user-pinned `deck.tokens`)
 *  stores them as bare names ("Map", "Blood"). Compare on the bare form. */
function normalizeTokenName(name: string): string {
  return name.toLowerCase().replace(/\s+token$/i, "");
}

export function asDeckCard(deck: Deck | undefined, gameCard: GameCard): DeckCard {
  // The deck can be missing (e.g. prompt cards carry no ownerId, so the
  // gameDecks lookup misses, or a hosted opponent's deck isn't local). Match
  // against an empty pool then fall through to a name/synthetic resolution
  // rather than dereferencing an undefined deck and crashing the board.
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
  // The engine may not carry the printing through — the hosted Forge backend
  // emits empty setCode/cardNumber for every card — so the exact match misses
  // deck cards pinned to a specific printing (e.g. a commander). Fall back to
  // a name match; the singleton deck makes this unambiguous for non-basics.
  const byName = pool.find((c) => c.name === gameCard.name);
  if (byName) return byName;
  // The engine can surface cards that were never in the deck (tokens already
  // handled above, plus engine-internal objects like effects/emblems). Render
  // them by name rather than crashing the whole board.
  console.warn(
    `asDeckCard: no deck match for "${gameCard.name}" (${gameCard.setCode}#${gameCard.cardNumber}), rendering by name`,
  );
  return {
    name: gameCard.name,
    setCode: gameCard.setCode,
    cardNumber: gameCard.cardNumber,
    // `uris` must be present — renderers read `deckCard.uris[resolution]`
    // directly. Empty means no art (renders by name) rather than a crash.
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

/** Cards whose `allParts` contributes to the deck's derived token list. */
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

/** Set of lowercased token names produced by anything currently in the deck.
 *  Filtered to `component === "token"` so combo_piece / meld_part / meld_result
 *  entries don't keep an orphaned customized token alive. */
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

/** Derive the token list from each card's `allParts`. Filters to
 *  `component === "token"` (Scryfall also lists the source card itself,
 *  combo pieces, and meld parts/results — none of which are tokens).
 *  Resolves each name against the token archive. Deduped by name. */
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
