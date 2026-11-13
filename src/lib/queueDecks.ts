import { assessBracket } from "@/lib/brackets";
import { fetchGameChangers } from "@/lib/gameChangers";
import type { SavedDeck } from "@/stores/useDeckStore";
import type { QueuedDeck } from "@/types/server";

export async function commanderQueueDecks(decks: SavedDeck[]): Promise<QueuedDeck[]> {
  const commanderDecks = decks.filter(
    ({ deck }) => deck.format === "commander" && (deck.commanders?.length ?? 0) > 0,
  );
  if (commanderDecks.length === 0) return [];
  const gameChangers = await fetchGameChangers();
  return commanderDecks.map(({ deck }) => ({
    deck_name: deck.name,
    deck,
    commander_name: deck.commanders?.[0]?.identity.name,
    bracket: assessBracket(deck, gameChangers, []).bracket,
  }));
}
