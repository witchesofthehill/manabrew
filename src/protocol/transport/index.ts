import type { DisplayEvent } from "@/protocol/display";
import type { GameView } from "@/types/manabrew";
import type { PromptInput } from "@/protocol/prompts";

export interface PromptRequestEnvelope {
  promptId?: string;
  decidingPlayerId?: string;
  sourceCardId?: string;
  displayEvents?: DisplayEvent[];
}

export type PromptRequest<TInput extends { type: string }> = PromptRequestEnvelope & {
  input: {
    gameView: GameView;
  } & TInput;
};

// `TInput extends unknown` distributes over each member of the union (only a
// naked type parameter distributes), so `Prompt` is a discriminated union of
// full requests — required for `prompt.input.type` to narrow.
type DistributeRequest<TInput extends { type: string }> = TInput extends unknown
  ? PromptRequest<TInput>
  : never;

export type Prompt = DistributeRequest<PromptInput>;
