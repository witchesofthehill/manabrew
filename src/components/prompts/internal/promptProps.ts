import type { DeckCard } from "@/protocol/deck";

export interface PromptProps<I, O> {
  input: I;
  respond: (output: O) => void;
  sourceCard?: DeckCard;
}
