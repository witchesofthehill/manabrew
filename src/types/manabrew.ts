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
  editor?: DeckEditorMetadata;
};

export interface DeckEditorTag {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface DeckEditorGroup {
  id: string;
  name: string;
  cardNames: string[];
  collapsed?: boolean;
  pinned?: boolean;
}

export interface DeckEditorLayout {
  id: string;
  name: string;
  groupBy: "type" | "cmc" | "color" | "custom";
  sortBy: "name" | "mana-value" | "quantity";
  groups: DeckEditorGroup[];
  filter?: string;
  cardSize?: number;
  defaultDestination?: "main" | "side" | "maybe";
}

export interface DeckEditorMetadata {
  version: 1;
  tags: DeckEditorTag[];
  layouts: DeckEditorLayout[];
  activeLayoutId?: string;
}

export interface User {
  username: string;
  serverAddress: string;
  flag?: string;
}
