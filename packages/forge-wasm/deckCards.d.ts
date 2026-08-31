export interface DeckCardLike {
  identity?: { name?: string | null } | null;
  name?: string | null;
}

export interface DeckLike {
  cards?: DeckCardLike[] | null;
  commanders?: DeckCardLike[] | null;
  sideboard?: DeckCardLike[] | null;
  attractions?: DeckCardLike[] | null;
  contraptions?: DeckCardLike[] | null;
  schemes?: DeckCardLike[] | null;
  planes?: DeckCardLike[] | null;
  companion?: DeckCardLike | null;
}

export declare function deckCardNames(decks: Array<DeckLike | undefined | null>): string[];
