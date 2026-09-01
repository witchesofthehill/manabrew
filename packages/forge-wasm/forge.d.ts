import type {
  DirectiveInput,
  DisplayEvent,
  Prompt,
  PromptOutput,
  ProtocolError,
  StateUpdate,
} from "@manabrew/protocol";

export interface ForgeCardIdentity {
  name: string;
  setCode?: string;
  cardNumber?: string;
}

export interface ForgeDeckCard {
  identity?: ForgeCardIdentity;
  name?: string;
  setCode?: string;
  cardNumber?: string;
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
  forgeAssets?: string;
}

export interface ForgeStartMultiplayerGameOptions {
  decks: ForgeDeck[];
  playerNames: string[];
  enginePlayerIndex: number;
  commanderNames?: Array<string | null>;
  startingLife?: number;
  forgeAssets?: string;
}

/**
 * The four message families the engine emits, and the whole of them. `state`
 * carries the game view, `prompt` a call to action that carries no view,
 * `display` an animation hint, and `error` a rejection of the last response.
 */
export type ForgeEngineMessage =
  | { kind: "state"; state: StateUpdate }
  | { kind: "prompt"; prompt: Prompt }
  | { kind: "display"; event: DisplayEvent }
  | { kind: "error"; error: ProtocolError };

export interface ForgeEngineOptions {
  workerUrl?: string | URL;
  launcherUrl?: string | URL;
  wasmUrl?: string | URL;
  cardsetUrl?: string | URL;
  assetWasmUrl?: string | URL;
  assets?: string | ((decks: ForgeDeck[]) => string | Promise<string>);
  onMessage?: (message: ForgeEngineMessage, playerSlot?: string) => void;
  onState?: (state: StateUpdate, playerSlot?: string) => void;
  onPrompt?: (prompt: Prompt, playerSlot?: string) => void;
  onDisplay?: (event: DisplayEvent, playerSlot?: string) => void;
  /** The engine rejecting a response, or a failure reading the seat. */
  onError?: (error: ProtocolError | Error, playerSlot?: string) => void;
  onEvent?: (event: string, payload: unknown) => void;
}

export declare class ForgeEngine {
  constructor(options?: ForgeEngineOptions);
  init(): Promise<void>;
  buildAssets(decks: ForgeDeck[]): Promise<string>;
  startGame(options: ForgeStartGameOptions): Promise<"game-started">;
  startMultiplayerGame(options: ForgeStartMultiplayerGameOptions): Promise<"multiplayer-started">;
  respond(promptId: number, action: PromptOutput, playerSlot?: string): void;
  directive(directive: DirectiveInput, playerSlot?: string): void;
  dispose(): void;
}

export declare function createForgeEngine(options?: ForgeEngineOptions): Promise<ForgeEngine>;
export declare const VERSION: string;
export declare const CARDSET_ARCHIVE_VERSION: string;
export declare const BUILD_COMMIT: string;
