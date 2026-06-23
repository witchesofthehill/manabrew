// SPDX-License-Identifier: GPL-3.0-or-later

import type { Deck as DeckDto } from "@/protocol/deck";

export interface CardIdentity {
  id: string;
  name: string;
  setCode: string;
  cardNumber: string;
  foil?: boolean;
}

export interface CardRulesSummary {
  color: string;
  colorIdentity: string[];
  manaCost: string;
  cmc: number;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  keywords?: string[];
  power?: string;
  toughness?: string;
  text: string;
  /** Scryfall's `layout` string. Drives sideways-frame rendering. */
  layout?: string;
  isDoubleFaced?: boolean;
}

/** A deck open in the deck-builder: the wire `Deck` plus editor-only scratch
 *  that never reaches the engine — saved with the deck, dropped on the wire. */
export type EditorDeck = DeckDto & {
  customTags?: string[];
  cardTags?: Record<string, string[]>;
};

export interface User {
  username: string;
  serverAddress: string;
  flag?: string;
}
