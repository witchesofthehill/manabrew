import type { PromptInput } from "@/protocol";

export interface PromptRequestEnvelope {
  promptId?: string;
  decidingPlayerId?: string;
  sourceCardId?: string;
}

export type PromptRequest<TInput extends { type: string }> = PromptRequestEnvelope & {
  input: TInput;
};

type DistributeRequest<TInput extends { type: string }> = TInput extends unknown
  ? PromptRequest<TInput>
  : never;

export type Prompt = DistributeRequest<PromptInput>;
