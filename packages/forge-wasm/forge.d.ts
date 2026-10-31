import type {
  DirectiveInput,
  EngineDirective,
  Prompt,
  PromptOutput,
  ProtocolError,
  StateUpdate,
} from "@manabrew/protocol";

export interface ForgeDecisionJournalEntry {
  sequence: number;
  playerIndex: number;
  prompt: Prompt | null;
  action: Record<string, unknown>;
  verification: { state: string; rng: string };
}

export interface ForgeDecisionJournalBatch {
  version: 2;
  nextSequence: number;
  startRequest?: string;
  unavailableReason?: string;
  entries: ForgeDecisionJournalEntry[];
}

export interface ForgeCardIdentity {
  name: string;
  setCode?: string;
  cardNumber?: string;
  foil?: boolean;
}

export interface ForgeDeckCard {
  identity?: ForgeCardIdentity;
  name?: string;
  setCode?: string;
  cardNumber?: string;
  foil?: boolean;
  count?: number;
}

/**
 * Every zone is read when card scripts are selected, so pass the whole deck: a
 * card left out arrives at the table as an unsupported placeholder.
 *
 * Looser than the protocol's `Deck`, which wants a full Scryfall row per card.
 * A `Deck` satisfies this, so either will do.
 */
export interface ForgeDeck {
  name?: string;
  format?: string;
  cards: ForgeDeckCard[];
  commanders?: ForgeDeckCard[];
  sideboard?: ForgeDeckCard[];
  attractions?: ForgeDeckCard[];
  contraptions?: ForgeDeckCard[];
  schemes?: ForgeDeckCard[];
  planes?: ForgeDeckCard[];
  companion?: ForgeDeckCard;
}

export interface ForgeStartGameOptions {
  deck: ForgeDeck;
  opponentDecks?: ForgeDeck[];
  startingLife?: number;
  commanderName?: string;
  /** Uses Forge's internal AI for opponent seats instead of external SAB clients. */
  forgeAi?: boolean;
  /** Pins the shuffle. Omitted, the engine seeds from the clock. */
  seed?: number;
  /** Off, the engine takes no restore snapshots. Defaults to on. */
  snapshotRecording?: boolean;
  decisionJournal?: boolean;
  journalRewind?: boolean;
  gameId?: string;
}

export interface ForgeStartMultiplayerGameOptions {
  decks: ForgeDeck[];
  playerNames: string[];
  enginePlayerIndex: number;
  /** Seats controlled by Forge's internal AI instead of external SAB clients. */
  forgeAiSeats?: number[];
  /**
   * SAB seats a Manabot plays rather than a person. The engine describes the
   * board to such a seat only when it is prompted, and books the time its
   * prompts take separately in `forge:decision`.
   */
  botSeats?: number[];
  commanderNames?: Array<string | null>;
  startingLife?: number;
  /** Pins the shuffle. Omitted, the engine seeds from the clock. */
  seed?: number;
  /** Off, the engine takes no restore snapshots. Defaults to on. */
  snapshotRecording?: boolean;
  decisionJournal?: boolean;
  journalRewind?: boolean;
  gameId?: string;
}

/**
 * The four message families the engine emits, and the whole of them. `state`
 * carries the game view, `prompt` a call to action that carries no view,
 * `engineDirective` an out-of-band table notice that never touches the open
 * prompt, and `error` a rejection of the last response.
 */
export type ForgeEngineMessage =
  | { kind: "state"; state: StateUpdate }
  | { kind: "prompt"; prompt: Prompt }
  | { kind: "engineDirective"; directive: EngineDirective }
  | { kind: "error"; error: ProtocolError };

export interface ForgeEngineOptions {
  workerUrl?: string | URL;
  launcherUrl?: string | URL;
  wasmUrl?: string | URL;
  onMessage?: (message: ForgeEngineMessage, playerSlot?: string) => void;
  onState?: (state: StateUpdate, playerSlot?: string) => void;
  onPrompt?: (prompt: Prompt, playerSlot?: string) => void;
  onDirective?: (directive: EngineDirective, playerSlot?: string) => void;
  /** The engine rejecting a response, or a failure reading the seat. */
  onError?: (error: ProtocolError | Error, playerSlot?: string) => void;
  onEvent?: (event: string, payload: unknown) => void;
}

export declare class ForgeEngine {
  constructor(options?: ForgeEngineOptions);
  init(): Promise<void>;
  startGame(options: ForgeStartGameOptions): Promise<"game-started">;
  startMultiplayerGame(options: ForgeStartMultiplayerGameOptions): Promise<"multiplayer-started">;
  respond(promptId: number, action: PromptOutput, playerSlot?: string): void;
  directive(directive: DirectiveInput, playerSlot?: string): void;
  dispose(): void;
}

export declare function createForgeEngine(options?: ForgeEngineOptions): Promise<ForgeEngine>;
export declare const VERSION: string;
export declare const BUILD_COMMIT: string;
