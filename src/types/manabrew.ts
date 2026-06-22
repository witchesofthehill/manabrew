// SPDX-License-Identifier: GPL-3.0-or-later
//
// Mirror of the engine-side DTOs in
// `manabrew-rs/crates/manabrew-agent-interface/`. The Rust crate is GPL by
// virtue of being engine-coupled; these mirrors inherit the GPL.

import type { ScryfallImageUris } from "@/types/scryfall";

export type DeckFormatId =
  | "standard"
  | "pioneer"
  | "modern"
  | "legacy"
  | "vintage"
  | "pauper"
  | "commander"
  | "brawl"
  | "oathbreaker"
  | "draft"
  | "sealed";

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

export interface GameCard extends CardIdentity, CardRulesSummary {
  basePower?: number;
  baseToughness?: number;
  /** Client-derived from the active prompt's AvailableActions (never on the
   *  wire). Stamped by `markIfPlayable` in the game view; absent = not playable. */
  isPlayable?: boolean;
  controllerId: string; // UUID
  ownerId: string; // UUID
  zoneId: string; // UUID
  tapped?: boolean;
  isCrewed?: boolean;
  isAttacking?: boolean;
  /** Encoded id (`player-N`) of the defender this creature is attacking,
   *  when `isAttacking` is true. Drives the persistent painterly attack
   *  arrow shown throughout combat. */
  attackingPlayerId?: string;
  counters?: Record<string, number>;
  damage?: number;
  /** Engine combat prediction: this creature would be destroyed by the current
   *  (committed) combat. Populated by the Forge harness. */
  wouldDieInCombat?: boolean;
  summoningSick?: boolean;
  isToken?: boolean;
  isCopy?: boolean;
  isTransformed?: boolean;
  isFaceDown?: boolean;
  foil?: boolean;
  isBestowed?: boolean;
  attachedTo?: string;
  attachmentIds?: string[];
  phasedOut?: boolean;
  exerted?: boolean;
  isRingBearer?: boolean;
  flashbackCost?: string;
  kickerCost?: string;
  effectiveManaCost?: string;
  madnessCost?: string;
  isMadnessExiled?: boolean;
  isPlotted?: boolean;
  isWarpExiled?: boolean;
}

export type AllPartsComponent = "token" | "combo_piece" | "meld_part" | "meld_result";

export interface DeckCard extends CardIdentity, CardRulesSummary {
  uris: ScryfallImageUris;
  /** Scryfall `all_parts` — entries this card references. `component` discriminates
   *  tokens from combo pieces, meld parts/results, and the self-reference Scryfall
   *  always includes. Token resolution is generic: name-only lookup against the
   *  token archive; `component === "token"` is the gate. */
  allParts?: Array<{ name: string; component: AllPartsComponent }>;
}

export interface DeckLabel {
  name: string;
  color?: string;
}

export interface Deck {
  id?: string;
  name: string;
  description?: string;
  color?: string;
  format?: DeckFormatId;
  cards: DeckCard[];
  sideboard: DeckCard[];
  /** Supplementary Attraction deck, separate from the sideboard like Forge RegisteredPlayer.getAttractions(). */
  attractions?: DeckCard[];
  /** Supplementary Contraption deck, separate from the sideboard like Forge RegisteredPlayer.getContraptions(). */
  contraptions?: DeckCard[];
  /** Supplementary Scheme deck, separate from the sideboard like Forge RegisteredPlayer.getSchemes(). */
  schemes?: DeckCard[];
  /** Supplementary Planar deck, separate from the sideboard like Forge RegisteredPlayer.getPlanes(). */
  planes?: DeckCard[];
  /** Designated commander(s) (Commander format). Not included in cards[]. Supports Partner. */
  commanders?: DeckCard[];
  /** Designated companion (any format). Not included in cards[] or sideboard[]. */
  companion?: DeckCard;
  /** Cards being considered but not in the playable deck. */
  maybeboard?: DeckCard[];
  /** When true, deck is a work-in-progress and not playable. */
  draft?: boolean;
  /** User-assigned labels for the deck (e.g. "Aggro", "Budget", "Competitive"). */
  labels?: DeckLabel[];
  /** User-created tag/label names for organizing cards into custom sections. */
  customTags?: string[];
  /** Maps card name (lowercased) → array of tag names the card belongs to. */
  cardTags?: Record<string, string[]>;
  /** Name of the card whose art is used as the deck cover. Falls back to cards[0] when absent or card no longer in deck. */
  coverCardName?: string;
  /** Which face of a double-faced cover card to use: 0 = front (default), 1 = back. */
  coverCardFace?: 0 | 1;
  /** Saved stack-view section positions (section ID → {x, y} in pixels). */
  stackPositions?: Record<string, { x: number; y: number }>;
  /** Cached token cards referenced by cards in this deck. */
  tokens?: DeckCard[];
}

export interface Player {
  id: string; // UUID
  name: string;
  isHuman: boolean;
  life: number;
  poison: number;
  hand: GameCard[];
  graveyard: GameCard[];
  exile: GameCard[];
  commandZone: GameCard[];
  libraryCount: number;
  manaPool: Record<string, number>; // W, U, B, R, G, C
  /** Commander damage received: source card id → total damage. */
  commanderDamage?: Record<string, number>;
  /** Energy counters (Kaladesh block). */
  energyCounters?: number;
  /** Radiation counters (Fallout Commander). */
  radiationCounters?: number;
  /** City's Blessing status (Ascend). */
  hasCityBlessing?: boolean;
  /** The Ring tempts you: 0 = no ring, 1-4 = level of temptation. */
  ringLevel?: number;
  /** Start Your Engines speed (Aetherdrift): 0 = no speed, 1-4. */
  speed?: number;
}

export interface Table {
  id: string; // UUID
  name: string;
  gameType: string;
  deckType: string;
  state: "WAITING" | "DUELING" | "SIDEBOARDING" | "FINISHED";
  numPlayers: number;
  players: PlayerInfo[];
  isTournament: boolean;
}

export interface PlayerInfo {
  name: string;
  avatar: string; // ID or path
  flag: string; // Country code
}

export interface GameView {
  gameId: string; // UUID
  turn: number;
  step: string; // Phase/Step name
  combatAssignments?: CombatAssignment[];
  activePlayerId: string; // UUID
  priorityPlayerId: string; // UUID
  players: Player[];
  battlefield: GameCard[];
  stack: StackObject[];
  gameOver?: boolean;
  winnerId?: string | null;
  concededPlayerIds?: string[];
  /** The player who is the current monarch. */
  monarchId?: string | null;
  /** The player who holds the initiative. */
  initiativeHolderId?: string | null;
}

export interface CombatAssignment {
  blockerId: string;
  attackerId: string;
}

export interface StackObject {
  id: string; // UUID
  sourceId: string; // UUID
  /** Player who cast/activated this spell or ability. */
  controllerId: string;
  name: string;
  text: string;
  /** Set code of the source card so the frontend can resolve the printing
   *  the engine is using. Empty string for runtime-minted tokens whose
   *  print isn't pinned. */
  setCode: string;
  /** Collector number paired with `setCode`. */
  cardNumber: string;
  /** True for permanent spells (creature/artifact/enchantment/planeswalker). */
  isPermanentSpell: boolean;
  /** True while the spell is announced but casting has not completed. */
  isCasting?: boolean;
  /** Normalized chosen targets flattened across ability/sub-ability nodes. */
  targets: StackTarget[];
}

export type StackTargetKind = "card" | "player" | "stack";

export interface StackTarget {
  kind: StackTargetKind;
  /** Encoded game entity id: card-*, player-*, stack-* */
  id: string;
  /** Zero-based index in the ability chain (root node = 0). */
  nodeIndex: number;
  /** Zero-based target slot index within the node. */
  targetIndex: number;
  /** Whether this target is hostile (damage/destroy) vs friendly (buff).
   *  Kept for backwards compatibility; prefer `intent`. */
  hostile: boolean;
  /** Semantic classification used to pick a pointer icon and glow color. */
  intent: import("@/types/promptType").TargetingIntent;
}

export interface ActivatableAbilityInfo {
  cardId: string;
  abilityIndex: number;
  description: string;
  isManaAbility: boolean;
  cost?: string;
  producedMana?: import("@/protocol/prompts/common").Mana[];
}

export interface ClientCallback {
  id: string; // UUID
  method: string; // e.g., "askYesNo", "chooseMode"
  data: unknown; // Context specific payload
}

// Middleware API Response Types
export interface MiddlewareResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface LoginResponse {
  sessionId: string;
  user: User;
}

export interface User {
  username: string;
  serverAddress: string;
  flag?: string;
}
