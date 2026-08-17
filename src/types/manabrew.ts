// SPDX-License-Identifier: GPL-3.0-or-later

import type {
  Deck as DeckDto,
  DeckEditorGoals as DeckEditorGoalsDto,
  DeckEditorGroup as DeckEditorGroupDto,
  DeckEditorLayout as DeckEditorLayoutDto,
  DeckEditorMetadata as DeckEditorMetadataDto,
  DeckEditorTag as DeckEditorTagDto,
  DeckSideboardPlan as DeckSideboardPlanDto,
} from "@/protocol/deck";

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

/** The shared deck snapshot includes editor metadata for account round-trips;
 *  gameplay consumers ignore those optional fields. */
export type EditorDeck = DeckDto;
export type DeckEditorTag = DeckEditorTagDto;
export type DeckEditorGroup = DeckEditorGroupDto;
export type DeckEditorLayout = DeckEditorLayoutDto;
export type DeckEditorMetadata = DeckEditorMetadataDto;
export type DeckEditorGoals = DeckEditorGoalsDto;
export type DeckSideboardPlan = DeckSideboardPlanDto;

export interface User {
  username: string;
  serverAddress: string;
  flag?: string;
}
