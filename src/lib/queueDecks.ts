import { assessBracket } from "@/lib/brackets";
import { fetchGameChangers } from "@/lib/gameChangers";
import { findMyCombos } from "@/api/commanderSpellbook";
import { fetchComboVotes } from "@/api/edhrec";
import type { Deck } from "@/protocol/deck";
import { deckAnalysisSignature } from "@/stores/useDeckAnalysisStore";
import type { QueuedDeck } from "@/types/server";

export const ANALYSIS_CONCURRENCY = 4;

const deckBrackets = new Map<string, Promise<number>>();

async function assessDeckBracket(deck: Deck): Promise<number> {
  const gameChangers = await fetchGameChangers();
  try {
    const combos = await findMyCombos(
      (deck.commanders ?? []).map((c) => c.identity.name),
      deck.cards.map((c) => c.identity.name),
    );
    const community = await fetchComboVotes(combos.included);
    return assessBracket(deck, gameChangers, combos.included, community.votes).bracket;
  } catch (error) {
    console.warn("[matchmaking] combo analysis failed, using Game Changers only", error);
    return assessBracket(deck, gameChangers, []).bracket;
  }
}

export function deckBracket(deck: Deck): Promise<number> {
  const key = deckAnalysisSignature(deck);
  let bracket = deckBrackets.get(key);
  if (!bracket) {
    bracket = assessDeckBracket(deck);
    deckBrackets.set(key, bracket);
    bracket.catch(() => deckBrackets.delete(key));
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
