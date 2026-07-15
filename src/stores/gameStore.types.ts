import type { Prompt, PromptOutput } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";
import type { GameViewDto } from "@/protocol/game";
import type { Deck } from "@/protocol/deck";
import type { GameLogEntry } from "@/types/gameLog";
import type { GameSnapshotEntry } from "@/types/gameSnapshot";
import type { EngineKind, GameFormat } from "@/types/server";
import type { IronsmithDeckIssue } from "@/game";

export type { DisplayEvent };

export interface GameConfig {
  formatId: string;
  startingLife: number;
}

/** One ordered effect queued for flash-then-apply processing: animate
 *  `displayEvents`, then apply `gameView` and/or `prompt` if present. Each
 *  incoming message (display / state / prompt) becomes one of these. */
export interface DeferredSnapshot {
  displayEvents: DisplayEvent[];
  gameView: GameViewDto | null;
  prompt: Prompt | null;
}

export interface GameState {
  gameView: GameViewDto | null;
  currentPrompt: Prompt | null;
  gameLog: GameLogEntry[];
  snapshots: GameSnapshotEntry[];
  isGameActive: boolean;
  debugInfo: string;
  /** Set when the host engine fails fatally (crash / invalid deck / can't
   *  start). The game view shows this instead of hanging on the loading
   *  screen. Cleared when a new game starts. */
  fatalError: string | null;
  /** Set when an Ironsmith match can't start because the deck contains cards the
   *  runtime doesn't implement yet. Drives the unsupported-deck modal, shown
   *  instead of a raw error toast. Cleared on dismiss and on the next start. */
  ironsmithDeckError: IronsmithDeckIssue[] | null;
  dismissIronsmithDeckError: () => void;
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
  /** Optimistic: true from when the local player passes/declines a decision until the next prompt
   *  for them arrives. Lets the UI reflect "waiting for others" instantly, without the state lag. */
  relinquishedPriority: boolean;
  gameConfig: GameConfig | null;
  /** Set at concede click, before the engine confirms via `status: "conceded"`. */
  selfConceded: boolean;
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
  /** Local view-only set of player slots whose playmat the viewer has hidden.
   *  Never synced — it only affects this client's board. Cleared on game end. */
  hiddenPlaymats: Set<string>;
  togglePlaymatHidden: (playerId: string) => void;
  updateGameView: (view: GameViewDto) => void;
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
  startManualRoomClient: (localPlayerSlot: string, initialGameView?: GameViewDto) => Promise<void>;
  stopManualRoomSync: () => void;
  startMultiplayerGame: (
    playerNames: string[],
    decks: Deck[],
    commanderNames: Array<string | null>,
    enginePlayerIndex: number,
    localIsHost: boolean,
    startingLife: number,
    engine?: EngineKind,
    format?: GameFormat,
    hostPlayerSlot?: string | null,
    botPlayerSlots?: string[],
  ) => Promise<void>;
  respond: (output: PromptOutput["output"]) => Promise<void>;
  concede: () => Promise<void>;
  endGame: () => Promise<void>;
  setMultiplayerState: (
    isMultiplayer: boolean,
    isHost: boolean,
    myPlayerSlot: string | null,
  ) => void;
  restoreSnapshot: (checkpointId: number) => Promise<void>;
}
