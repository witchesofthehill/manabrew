import type { GameView, GameCard, ActivatableAbilityInfo, Deck } from "@/types/manabrew";
import type { GameLogEntry } from "@/types/gameLog";
import type { GameSnapshotEntry } from "@/types/gameSnapshot";
import type { PromptType, TargetingIntent } from "@/types/promptType";
import type { EngineKind } from "@/types/server";

export interface DisplayEvent {
  kind: string;
  cardId?: string;
  cardName?: string;
  setCode?: string;
  playerId?: string;
  activePlayerId?: string;
  activePlayerName?: string;
  turnNumber?: number;
}

export interface AgentPrompt {
  /** Player slot this prompt is waiting on, e.g. "player-0". */
  decidingPlayerId?: string;
  type: PromptType;
  gameView: GameView;
  displayEvents?: DisplayEvent[];
  playableCardIds?: string[];
  /** All play options with modes (normal, spectacle, evoke, etc.) */
  playableOptions?: { cardId: string; mode: string; modeLabel: string }[];
  /** Semantic auto-pass guard for prompts whose available actions are opaque to normal heuristics. */
  autoPassDisabled?: boolean;
  handCardIds?: string[];
  availableAttackerIds?: string[];
  attackerIds?: string[];
  availableBlockerIds?: string[];
  validPlayerIds?: string[];
  validCardIds?: string[];
  tappableLandIds?: string[];
  /** Source IDs whose most recent mana action can currently be undone. */
  untappableLandIds?: string[];
  zone?: string;
  zoneCards?: GameCard[];
  /** IDs of library cards revealed for scry / surveil / dig */
  cardIds?: string[];
  /** Card DTOs for the revealed library cards */
  cards?: GameCard[];
  /** revealCards: owner of the hidden zone being shown */
  ownerPlayerId?: string;
  /** dig: maximum number of cards the player may take */
  numToTake?: number;
  /** dig: whether taking 0 cards is allowed */
  optional?: boolean;
  /** chooseDiscard: how many must be discarded */
  numToDiscard?: number;
  /** chooseTargetSpell: stack entry IDs that can be countered */
  validSpellIds?: string[];
  /** chooseMode: human-readable descriptions for each available mode */
  options?: string[];
  /** chooseMode: minimum number of modes that must be chosen */
  minChoices?: number;
  /** chooseMode: maximum number of modes that can be chosen */
  maxChoices?: number;
  /** chooseOptionalTrigger: trigger description text */
  description?: string;
  /** revealCards: display message */
  message?: string;
  /** chooseOptionalTrigger: context tag (optional_trigger | confirm_action) */
  promptKind?: string;
  /** chooseOptionalTrigger: optional labels for decline/accept buttons */
  optionLabels?: string[];
  /** chooseOptionalTrigger/confirmAction: optional mode metadata */
  mode?: string;
  /** chooseOptionalTrigger/confirmAction: optional API metadata */
  api?: string;
  /** payCostToPreventEffect: stable cost kind identifier */
  costKind?: string;
  /** choosePhyrexian: the phyrexian shard string (e.g. "W/P") */
  phyrexianColor?: string;
  /** chooseKicker: the kicker cost string */
  kickerCost?: string;
  /** Source card name for displaying card image in modals */
  sourceCardName?: string;
  /** Source card ID for targeting prompts (identifies the card being cast) */
  sourceCardId?: string;
  /** Whether the targeting effect is hostile (damage/destroy) vs friendly (buff).
   *  Kept for backwards compatibility; prefer `intent`. */
  hostile?: boolean;
  /** Semantic classification used by the UI to pick a pointer icon and glow color. */
  intent?: TargetingIntent;
  /** chooseBuyback: the buyback cost string */
  buybackCost?: string;
  /** chooseMultikicker / chooseReplicate: the cost per iteration */
  cost?: string;
  /** chooseMultikicker: max number of kicks */
  maxKicks?: number;
  /** chooseReplicate: max number of replicates */
  maxReplicates?: number;
  /** chooseColor: valid color choices */
  validColors?: string[];
  /** chooseType: category of type to choose */
  typeCategory?: string;
  /** chooseType: valid type choices */
  validTypes?: string[];
  /** chooseNumber: minimum value */
  min?: number;
  /** chooseNumber: maximum value */
  max?: number;
  /** chooseCardName: valid card name choices */
  validNames?: string[];
  /** chooseAction: activated abilities on battlefield permanents */
  activatableAbilityIds?: ActivatableAbilityInfo[];
  /** mulligan: how many mulligans taken so far */
  mulliganCount?: number;
  /** mulliganPutBack: how many cards must be put on the bottom */
  count?: number;
  /** chooseAttackers: possible defenders (players and planeswalkers) */
  possibleDefenderIds?: { id: string; label: string }[];
  /** chooseDamageAssignmentOrder: the attacker card ID */
  attackerId?: string;
  /** chooseDamageAssignmentOrder: blocker IDs to order */
  blockerIds?: string[];
  /** chooseDamageAssignmentOrder: blocker GameCard info */
  blockerCards?: GameCard[];
  /** chooseCombatDamageAssignment: defender id ("player-{i}" or "card-{i}") */
  defenderId?: string | null;
  /** chooseCombatDamageAssignment: total damage to assign */
  totalDamage?: number;
  /** chooseCombatDamageAssignment: attacker has deathtouch */
  attackerHasDeathtouch?: boolean;
  /** payManaCost: the card being cast */
  cardId?: string;
  /** payManaCost: card display name */
  cardName?: string;
  /** payManaCost: mana cost string (e.g. "{2}{R}") */
  manaCost?: string;
  /** payManaCost: available mana abilities for the listed tappable permanents */
  manaAbilityOptions?: ActivatableAbilityInfo[];
  /** chooseDelve/chooseConvoke: remaining cost string */
  remainingCost?: string;
  /** chooseDelve: max cards to exile */
  maxCards?: number;
  /** payCombatCost: attacker card ID */
  attackerIdForCost?: string;
  /** payCombatCost: attacker display name */
  attackerName?: string;
  /** payCombatCost: mana pool total available */
  manaPoolTotal?: number;
  /** payManaCost: whether the current pool can already confirm payment */
  canConfirmFromPool?: boolean;
  /** specifyManaCombo: available color letters */
  availableColors?: string[];
  /** specifyManaCombo: total mana to distribute */
  amount?: number;
  /** exploreDecision: name of the revealed card */
  revealedCardName?: string;
  /** exploreDecision: card DTO for the revealed card */
  revealedCard?: GameCard;
  /** chooseExertAttackers / chooseEnlistAttackers: attacker card IDs */
  attackerCardIds?: string[];
  /** chooseExertAttackers / chooseEnlistAttackers: attacker card DTOs */
  attackerCards?: GameCard[];
  /** helpPayAssist: max generic mana the assisting player can pay */
  maxGeneric?: number;

  // ── Dice rolls ────────────────────────────────────────────────
  /** diceRolled: number of sides on each rolled die */
  sides?: number;
  /** diceRolled: who rolled (player slot id, e.g. "player-0") */
  playerId?: string;
  /** diceRolled: pre-modifier values for each kept die */
  naturalResults?: number[];
  /** diceRolled: post-modifier values for each kept die */
  finalResults?: number[];
  /** diceRolled: dropped before modification (ignore-lowest, choose-to-ignore) */
  ignoredRolls?: number[];
  /** chooseRollToIgnore/Swap/Modify, chooseDiceToReroll: candidate values */
  rolls?: number[];
  /** chooseRollSwapValue: the rolled value being exchanged */
  currentResult?: number;
  /** chooseRollSwapValue: current power of the target creature */
  power?: number;
  /** chooseRollSwapValue: current toughness of the target creature */
  toughness?: number;
  /** firstPlayerRoll: per-player roll-off entries */
  firstPlayerRolls?: { playerId: string; playerName: string; value: number }[];
  /** firstPlayerRoll: id of the player who won the roll-off */
  winnerPlayerId?: string;
}

export interface GameConfig {
  formatId: string;
  startingLife: number;
}

/** A snapshot queued for sequential flash-then-apply processing. */
export interface DeferredSnapshot {
  displayEvents: DisplayEvent[];
  gameView: GameView;
  /** null for display-only state updates (no player decision). */
  prompt: AgentPrompt | null;
}

export interface GameState {
  gameView: GameView | null;
  currentPrompt: AgentPrompt | null;
  gameLog: GameLogEntry[];
  snapshots: GameSnapshotEntry[];
  isGameActive: boolean;
  debugInfo: string;
  /** Card-image prefetch progress shown on the loading screen. Reset to
   *  null between games. Populated while the start-game flow is fetching
   *  Scryfall textures, before the engine is allowed to emit prompts. */
  isPrefetchingCards: boolean;
  /** Queue of deferred snapshots waiting for flash animation. */
  deferredQueue: DeferredSnapshot[];
  /** True while Game.tsx is processing flash animations. */
  isFlashing: boolean;
  /** True after respond() is called and before the next prompt arrives — prevents double-submit. */
  isWaitingForResponse: boolean;
  gameConfig: GameConfig | null;
  /** True if this is a networked multiplayer game. */
  isMultiplayer: boolean;
  /** True if this client is the host (runs the engine). */
  isHost: boolean;
  /** This player's slot identifier, e.g. "player-0", "player-1". */
  myPlayerSlot: string | null;
  /** Active game's decks keyed by player slot id ("player-0", "player-1", ...).
   *  Used by `asDeckCard(deck, gameCard)` callers to resolve the deck side of
   *  a game card without scanning unrelated decks. */
  gameDecks: Record<string, Deck>;
  updateGameView: (view: GameView) => void;
  setGameConfig: (config: GameConfig) => void;
  // Actions
  startGame: (
    deck: Deck,
    formatId?: string,
    commanderName?: string,
    opponentDeck?: Deck,
    engine?: EngineKind,
  ) => Promise<void>;
  startManualTabletopGame: (deck: Deck, formatId?: string, commanderName?: string) => Promise<void>;
  startManualRoomHost: (localPlayerSlot: string) => Promise<void>;
  startManualRoomClient: (localPlayerSlot: string, initialGameView?: GameView) => Promise<void>;
  stopManualRoomSync: () => void;
  startMultiplayerGame: (
    playerNames: string[],
    decks: Deck[],
    commanderNames: Array<string | null>,
    enginePlayerIndex: number,
    localIsHost: boolean,
    startingLife: number,
  ) => Promise<void>;
  respond: (action: Record<string, unknown>) => Promise<void>;
  castSpell: (cardId: string, mode?: string) => void;
  passPriority: (untilPhase?: string | null) => void; // null = atomic pass, string = pass until phase
  declareAttackers: (attackerIds: string[], defenderId?: string) => void;
  declareBlockers: (assignments: { blockerId: string; attackerId: string }[]) => void;
  targetPlayer: (playerId: string | null) => void;
  targetCard: (cardId: string | null) => void;
  targetAny: (target: { kind: string; playerId?: string; cardId?: string }) => void;
  mulliganDecision: (keep: boolean) => void;
  mulliganPutBackDecision: (cardIds: string[]) => void;
  tapLand: (cardId: string, abilityIndex?: number, color?: string) => void;
  untapLand: (cardId: string) => void;
  activateAbility: (cardId: string, abilityIndex: number) => void;
  scryDecision: (bottomCardIds: string[]) => void;
  surveilDecision: (graveyardCardIds: string[]) => void;
  digDecision: (chosenCardIds: string[]) => void;
  discardDecision: (discardedCardIds: string[]) => void;
  targetSpell: (spellId: string | null) => void;
  modeDecision: (chosenIndices: number[]) => void;
  revealCardsAcknowledged: () => void;
  payCostToPreventEffectDecision: (accept: boolean) => void;
  optionalTriggerDecision: (accept: boolean) => void;
  colorDecision: (color: string | null) => void;
  chooseCardsDecision: (chosenCardIds: string[]) => void;
  typeDecision: (chosenType: string | null) => void;
  numberDecision: (chosenNumber: number | null) => void;
  cardNameDecision: (chosenName: string | null) => void;
  payCombatCost: () => void;
  declineCombatCost: () => void;
  payManaCost: (auto?: boolean) => void;
  autoManaCost: () => void;
  cancelManaCost: () => void;
  delveDecision: (chosenCardIds: string[]) => void;
  convokeDecision: (chosenCardIds: string[]) => void;
  improviseDecision: (chosenCardIds: string[]) => void;
  manaComboDecision: (chosenColors: string[]) => void;
  exploreDecision: (putInGraveyard: boolean) => void;
  exertDecision: (chosenAttackerIds: string[]) => void;
  enlistDecision: (chosenAttackerIds: string[]) => void;
  reorderLibraryDecision: (orderedCardIds: string[]) => void;
  assistDecision: (amountToPay: number) => void;
  diceRolledAcknowledged: () => void;
  firstPlayerRollAcknowledged: () => void;
  rollToIgnoreDecision: (roll: number | null) => void;
  rollToSwapDecision: (roll: number | null) => void;
  rollToModifyDecision: (roll: number | null) => void;
  diceToRerollDecision: (rolls: number[]) => void;
  rollSwapValueDecision: (choice: "power" | "toughness" | null) => void;
  concede: () => Promise<void>;
  endGame: () => Promise<void>;
  setMultiplayerState: (
    isMultiplayer: boolean,
    isHost: boolean,
    myPlayerSlot: string | null,
  ) => void;
  restoreSnapshot: (checkpointId: number) => Promise<void>;
}
