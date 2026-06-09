import type { GameView } from "@/types/manabrew";
import type { PromptInput } from "@/protocol/prompts";

export interface PromptRequestEnvelope {
  promptId?: string;
  decidingPlayerId?: string;
  sourceCardId?: string;
}

export type PromptRequest<TInput extends { type: string }> = PromptRequestEnvelope & {
  input: TInput;
};

// `TInput extends unknown` distributes over each member of the union (only a
// naked type parameter distributes), so `Prompt` is a discriminated union of
// full requests — required for `prompt.input.type` to narrow.
type DistributeRequest<TInput extends { type: string }> = TInput extends unknown
  ? PromptRequest<TInput>
  : never;

export type Prompt = DistributeRequest<PromptInput>;

// The sole carrier of game state. Mirrors the Rust `StateUpdate`.
export interface StateUpdate {
  gameView: GameView;
}
