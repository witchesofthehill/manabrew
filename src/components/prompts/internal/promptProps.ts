export interface PromptProps<I, O> {
  input: I;
  respond: (output: O) => void;
}
