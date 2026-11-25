import { assessBracket } from "@/lib/brackets";
import { fetchGameChangers } from "@/lib/gameChangers";
import { findMyCombos } from "@/api/commanderSpellbook";
import { fetchComboVotes } from "@/api/edhrec";
import { STORAGE_KEYS } from "@/lib/constants";
import type { Deck } from "@/protocol/deck";
import { deckAnalysisSignature } from "@/stores/useDeckAnalysisStore";
import type { QueuedDeck } from "@/types/server";

export const ANALYSIS_CONCURRENCY = 4;

/** Bump when `assessBracket` changes, so every stored bracket is recomputed. */
export const DECK_BRACKET_CACHE_VERSION = 1;
const DECK_BRACKET_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DECK_BRACKET_CACHE_LIMIT = 500;

interface StoredBracket {
  bracket: number;
  checkedAt: number;
}

interface StoredBrackets {
  version: number;
  entries: Record<string, StoredBracket>;
}

const deckBrackets = new Map<string, Promise<number>>();
let stored: Record<string, StoredBracket> | null = null;

/** cyrb53: a stable 53-bit key for a deck signature. */
function signatureKey(signature: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < signature.length; i += 1) {
    const ch = signature.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function storedBrackets(): Record<string, StoredBracket> {
  if (stored) return stored;
  stored = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DECK_BRACKETS);
    const parsed = raw ? (JSON.parse(raw) as Partial<StoredBrackets>) : null;
    if (parsed?.version === DECK_BRACKET_CACHE_VERSION && parsed.entries) stored = parsed.entries;
  } catch {
    // Unreadable cache: start empty and overwrite it on the next save.
  }
  return stored;
}

function storeBracket(key: string, bracket: number) {
  const entries = storedBrackets();
  entries[key] = { bracket, checkedAt: Date.now() };
  const keys = Object.keys(entries);
  if (keys.length > DECK_BRACKET_CACHE_LIMIT) {
    keys
      .sort((a, b) => entries[a].checkedAt - entries[b].checkedAt)
      .slice(0, keys.length - DECK_BRACKET_CACHE_LIMIT)
      .forEach((stale) => delete entries[stale]);
  }
  try {
    const value: StoredBrackets = { version: DECK_BRACKET_CACHE_VERSION, entries };
    localStorage.setItem(STORAGE_KEYS.DECK_BRACKETS, JSON.stringify(value));
  } catch (error) {
    console.warn("[matchmaking] could not save deck brackets", error);
  }
}

function storedBracket(deck: Deck): StoredBracket | undefined {
  return storedBrackets()[signatureKey(deckAnalysisSignature(deck))];
}

/** Last stored bracket for this exact card list, even when due for a recheck. */
export function cachedDeckBracket(deck: Deck): number | undefined {
  return storedBracket(deck)?.bracket;
}

export function hasFreshDeckBracket(deck: Deck): boolean {
  const entry = storedBracket(deck);
  return !!entry && Date.now() - entry.checkedAt < DECK_BRACKET_TTL_MS;
}

/** `complete` is false when combo data was missing and the bracket is a fallback
 *  estimate. Only complete results are stored across sessions. */
async function assessDeckBracket(deck: Deck): Promise<{ bracket: number; complete: boolean }> {
  const gameChangers = await fetchGameChangers();
  try {
    const combos = await findMyCombos(
      (deck.commanders ?? []).map((c) => c.identity.name),
      deck.cards.map((c) => c.identity.name),
    );
    const community = await fetchComboVotes(combos.included);
    return {
      bracket: assessBracket(deck, gameChangers, combos.included, community.votes).bracket,
      complete: !community.unavailable,
    };
  } catch (error) {
    console.warn("[matchmaking] combo analysis failed, using Game Changers only", error);
    return { bracket: assessBracket(deck, gameChangers, []).bracket, complete: false };
  }
}

export function deckBracket(deck: Deck): Promise<number> {
  const signature = deckAnalysisSignature(deck);
  const entry = storedBrackets()[signatureKey(signature)];
  if (entry && Date.now() - entry.checkedAt < DECK_BRACKET_TTL_MS) {
    return Promise.resolve(entry.bracket);
  }
  let bracket = deckBrackets.get(signature);
  if (!bracket) {
    bracket = assessDeckBracket(deck).then(({ bracket, complete }) => {
      if (complete) storeBracket(signatureKey(signature), bracket);
      return bracket;
    });
    deckBrackets.set(signature, bracket);
    bracket.catch(() => deckBrackets.delete(signature));
  }
  return bracket;
}

export async function commanderQueueDecks(decks: Deck[]): Promise<QueuedDeck[]> {
  const commanderDecks = decks.filter(
    (deck) => deck.format === "commander" && (deck.commanders?.length ?? 0) > 0,
  );
  const queued: QueuedDeck[] = [];
  for (let i = 0; i < commanderDecks.length; i += ANALYSIS_CONCURRENCY) {
    const batch = commanderDecks.slice(i, i + ANALYSIS_CONCURRENCY);
    const brackets = await Promise.all(batch.map(deckBracket));
    batch.forEach((deck, index) =>
      queued.push({
        deck_name: deck.name,
        deck,
        commander_name: deck.commanders?.[0]?.identity.name,
        bracket: brackets[index],
      }),
    );
  }
  return queued;
}

export function queueDeckChoices(decks: QueuedDeck[], bracket: number) {
  const distance = Math.min(...decks.map((deck) => Math.abs(deck.bracket - bracket)));
  return decks
    .map((deck, index) => ({ deck, index }))
    .filter(({ deck }) => Math.abs(deck.bracket - bracket) === distance);
}
