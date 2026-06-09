import { searchCards } from "@/api/scryfall";
import { frontFaceName } from "@/lib/scryfall.utils";

/** Normalize a card name for cross-source matching: front face only, lowercased.
 *  Deck cards store front-face names (see `scryfallToDeckCard`) while Scryfall and
 *  Commander Spellbook return full `Front // Back` names. */
export function normalizeCardName(name: string): string {
  return frontFaceName(name).trim().toLowerCase();
}

let cache: Promise<Set<string>> | null = null;

/** WotC's Commander "Game Changers" list, sourced live from Scryfall's
 *  `is:gamechanger` keyword so it tracks bracket updates automatically. */
export function fetchGameChangers(): Promise<Set<string>> {
  if (!cache) {
    cache = (async () => {
      const names = new Set<string>();
      let page = 1;
      for (;;) {
        const result = await searchCards("is:gamechanger", page, "name");
        for (const card of result.data) names.add(normalizeCardName(card.name));
        if (!result.has_more) break;
        page += 1;
      }
      return names;
    })().catch((err) => {
      cache = null;
      throw err;
    });
  }
  return cache;
}
