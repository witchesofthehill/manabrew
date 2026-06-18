import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { MODAL_INPUT } from "@/components/game/game.styles";
import { cn } from "@/lib/utils";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { PromptPresentation } from "./internal/PromptPresentation";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseNumberInput, ChooseNumberOutput } from "@/protocol";

export function ChooseNumberModal({
  input,
  respond,
}: PromptProps<ChooseNumberInput, ChooseNumberOutput>) {
  const { min, max, presentation } = input;
  const range = max - min + 1;
  const useButtons = range <= 10;
  const [inputValue, setInputValue] = useState(String(min));
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = parseInt(inputValue, 10);
  const isValid = !isNaN(parsed) && parsed >= min && parsed <= max;
  const showError = inputValue.trim() !== "" && !isValid;

  const confirm = useCallback(
    (chosenNumber: number) => respond({ type: "numberDecision", chosenNumber }),
    [respond],
  );

  useEffect(() => {
    if (!useButtons) {
      inputRef.current?.focus();
    }
  }, [min, max, useButtons]);

  const handleInputConfirm = useCallback(() => {
    if (isValid) {
      confirm(parsed);
    }
  }, [isValid, parsed, confirm]);

  const current = isNaN(parsed) ? min : Math.min(max, Math.max(min, parsed));
  const step = (delta: number) =>
    setInputValue(String(Math.min(max, Math.max(min, current + delta))));

  useModalKeyboard({ onEnter: !useButtons ? handleInputConfirm : undefined }, [
    useButtons,
    handleInputConfirm,
  ]);

  const numbers = useButtons ? Array.from({ length: range }, (_, i) => min + i) : [];

  const controls = useButtons ? (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Number choices">
      {numbers.map((num) => (
        <button
          key={num}
          onClick={() => confirm(num)}
          className={cn(
            "w-10 h-10 rounded-md border text-sm font-bold transition-all",
            "hover:border-primary hover:bg-primary/10",
            "border-border bg-background",
          )}
        >
          {num}
        </button>
      ))}
    </div>
  ) : (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label="Decrease"
          onClick={() => step(-1)}
          disabled={current <= min}
          className={cn(
            "flex h-20 w-14 items-center justify-center rounded-md border transition-all",
            "hover:border-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent",
            "border-border bg-background",
          )}
        >
          <Minus className="h-6 w-6" />
        </button>
        <input
          ref={inputRef}
          type="number"
          min={min}
          max={max}
          value={inputValue}
          aria-invalid={showError}
          onChange={(e) => setInputValue(e.target.value)}
          className={cn(
            MODAL_INPUT,
            "h-20 w-24 text-center text-3xl font-bold",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            showError && "border-destructive",
          )}
        />
        <button
          type="button"
          aria-label="Increase"
          onClick={() => step(1)}
          disabled={current >= max}
          className={cn(
            "flex h-20 w-14 items-center justify-center rounded-md border transition-all",
            "hover:border-primary hover:bg-primary/10 disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent",
            "border-border bg-background",
          )}
        >
          <Plus className="h-6 w-6" />
        </button>
        <Button
          aria-label="Confirm"
          onClick={handleInputConfirm}
          disabled={!isValid}
          className="h-20 w-20"
        >
          <Check className="h-7 w-7" />
        </Button>
      </div>
      <p className={cn("text-xs", showError ? "text-destructive" : "text-muted-foreground")}>
        Enter a number between {min} and {max}.
      </p>
    </div>
  );

  return (
    <Modal maxWidth="max-w-2xl" maxHeight="">
      <div className="p-6">
        <PromptPresentation presentation={presentation} forceHorizontal actions={controls} />
      </div>
    </Modal>
  );
}
