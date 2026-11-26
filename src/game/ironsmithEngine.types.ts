import type { Deck } from "@/protocol/deck";
import type { DirectiveInput, GameFormat, Prompt, PromptOutput, ProtocolError } from "@/protocol";
import type { GameViewDto } from "@/protocol/game";

export interface IronsmithDeckIssue {
  playerIndex: number;
  playerName: string;
  section: string;
  cardName: string;
  error: string;
}

export interface IronsmithMatchConfig {
  playerNames: string[];
  startingLife: number;
  seed: number;
  format: GameFormat | null;
  decks: Deck[];
  commanderNames: Array<string | null>;
  openingHandSize: number;
  botPlayers: number[];
  humanPlayers: boolean[];
}

export interface IronsmithViewResult {
  state?: { gameView?: GameViewDto };
  prompt?: Prompt;
  error?: ProtocolError;
}

export type IronsmithInput =
  | { kind: "response"; slot: string; promptId: number; action: PromptOutput }
  | { kind: "directive"; slot: string; directive: DirectiveInput };

export interface IronsmithEngineMethods {
  // Compiles the decks' cards ahead of `start`, which then finds them ready.
  prepare(decks: Deck[]): void;
  start(config: IronsmithMatchConfig, validate: boolean): IronsmithDeckIssue[] | null;
  view(viewer: number): IronsmithViewResult;
  publicState(): { gameView?: GameViewDto };
  apply(input: IronsmithInput): { error: ProtocolError | null; digest: string };
  botAction(slot: string, gameView: GameViewDto, prompt: Prompt): Promise<PromptOutput>;
  clearBots(): void;
}

export type IronsmithEngineRequest = {
  [K in keyof IronsmithEngineMethods]: {
    id: number;
    method: K;
    args: Parameters<IronsmithEngineMethods[K]>;
  };
}[keyof IronsmithEngineMethods];

export type IronsmithEngineResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };
