import { assessBracket } from "@/lib/brackets";
import { fetchGameChangers } from "@/lib/gameChangers";
import { analyzeDeckBracket } from "@/stores/useDeckAnalysisStore";
import type { Deck } from "@/protocol/deck";
import type { SavedDeck } from "@/stores/useDeckStore";
import type { QueuedDeck } from "@/types/server";

const ANALYSIS_CONCURRENCY = 4;

async function deckBracket(deck: Deck): Promise<number> {
  try {
    return (await analyzeDeckBracket(deck)).bracket.bracket;
  } catch (error) {
    console.warn("[matchmaking] combo analysis failed, using Game Changers only", error);
    return assessBracket(deck, await fetchGameChangers(), []).bracket;
  }
}

export async function commanderQueueDecks(decks: SavedDeck[]): Promise<QueuedDeck[]> {
  const commanderDecks = decks
    .map(({ deck }) => deck)
    .filter((deck) => deck.format === "commander" && (deck.commanders?.length ?? 0) > 0);
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
