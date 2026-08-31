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
 * Every zone here is read when the card scripts for a game are selected. A
 * card left out of a deck object reaches the table as an unsupported
 * placeholder, so pass the whole deck, not just the maindeck.
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

export type ForgeEngineMessage =
  | { kind: "state"; state: unknown }
  | { kind: "prompt"; prompt: unknown }
  | { kind: "display"; event: unknown }
  | { kind: "error"; error: unknown }
  | Record<string, unknown>;

export interface ForgeEngineOptions {
  workerUrl?: string | URL;
  launcherUrl?: string | URL;
  wasmUrl?: string | URL;
  cardsetUrl?: string | URL;
  assetWasmUrl?: string | URL;
  assets?: string | ((decks: ForgeDeck[]) => string | Promise<string>);
  onMessage?: (message: ForgeEngineMessage, playerSlot?: string) => void;
  onState?: (state: unknown, playerSlot?: string) => void;
  onPrompt?: (prompt: unknown, playerSlot?: string) => void;
  onDisplay?: (event: unknown, playerSlot?: string) => void;
  onError?: (error: unknown, playerSlot?: string) => void;
  onEvent?: (event: string, payload: unknown) => void;
}

export declare class ForgeEngine {
  constructor(options?: ForgeEngineOptions);
  init(): Promise<void>;
  buildAssets(decks: ForgeDeck[]): Promise<string>;
  startGame(options: ForgeStartGameOptions): Promise<"game-started">;
  startMultiplayerGame(options: ForgeStartMultiplayerGameOptions): Promise<"multiplayer-started">;
  respond(promptId: number, action: unknown, playerSlot?: string): void;
  directive(directive: unknown, playerSlot?: string): void;
  dispose(): void;
}

export declare function createForgeEngine(options?: ForgeEngineOptions): Promise<ForgeEngine>;
export declare const VERSION: string;
