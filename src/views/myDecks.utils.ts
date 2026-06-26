import type { DeckCard } from "@/protocol/deck";
import type { SavedDeck } from "@/stores/useDeckStore";
import { getDeckColors } from "@/components/deck/deckDisplay.utils";
export { type CardGroup, groupCards } from "@/components/editor/deckBuilder.utils";

//
export function categorize(
  groups: { card: DeckCard; count: number }[],
): { label: string; items: { card: DeckCard; count: number }[] }[] {
  const lands: typeof groups = [];
  const creatures: typeof groups = [];
  const other: typeof groups = [];

  for (const group of groups) {
    const types = group.card.types ?? [];
    if (types.includes("Land")) lands.push(group);
    else if (types.includes("Creature")) creatures.push(group);
    else other.push(group);
  }

  return [
    { label: "Creatures", items: creatures },
    { label: "Spells & Other", items: other },
    { label: "Lands", items: lands },
  ].filter((category) => category.items.length > 0);
}

export type SortBy = "name" | "color" | "updated";

export interface DeckFilters {
  search: string;
  formatFilter: string;
  colorFilter: string[];
  sortBy: SortBy;
}

const COLOR_BIT: Record<string, number> = { W: 16, U: 8, B: 4, R: 2, G: 1 };

function colorSortKey(colors: string[]): number {
  return colors.reduce((acc, color) => acc + (COLOR_BIT[color] ?? 0), 0);
}

export function applyDeckFilters(
  decks: SavedDeck[],
  filters: DeckFilters,
): { valid: SavedDeck[]; drafts: SavedDeck[] } {
  const { search, formatFilter, colorFilter, sortBy } = filters;

  const pass = decks.filter((savedDeck) => {
    if (search && !savedDeck.deck.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (formatFilter && (savedDeck.deck.format ?? "standard") !== formatFilter) return false;
    if (colorFilter.length > 0) {
      const deckColors = getDeckColors(savedDeck.deck.cards);
      if (!colorFilter.every((color) => deckColors.includes(color))) return false;
    }
    return true;
  });

  const sortFn = (left: SavedDeck, right: SavedDeck): number => {
    switch (sortBy) {
      case "name":
        return left.deck.name.localeCompare(right.deck.name);
      case "color": {
        const leftColors = getDeckColors(left.deck.cards);
        const rightColors = getDeckColors(right.deck.cards);
        if (leftColors.length !== rightColors.length) return leftColors.length - rightColors.length;
        return colorSortKey(rightColors) - colorSortKey(leftColors);
      }
      case "updated":
        return right.savedAt - left.savedAt;
      default:
        return 0;
    }
  };

  return {
    valid: pass.filter((savedDeck) => !savedDeck.deck.draft).sort(sortFn),
    drafts: pass.filter((savedDeck) => !!savedDeck.deck.draft).sort(sortFn),
  };
}
