import { Button } from "@/components/ui/button";
import { Modal } from "./Modal";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL, MODAL_INPUT } from "../game.styles";
import type { DeckCard } from "@/types/manabrew";

interface ChooseNumberModalProps {
  min: number;
  max: number;
  sourceCard?: DeckCard;
  onConfirm: (chosenNumber: number | null) => void;
}

export function ChooseNumberModal({ min, max, sourceCard, onConfirm }: ChooseNumberModalProps) {
  const range = max - min + 1;
  const useButtons = range <= 20;
  const [inputValue, setInputValue] = useState(String(min));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!useButtons) {
      inputRef.current?.focus();
    }
  }, [min, max, useButtons]);

  const handleInputConfirm = useCallback(() => {
    const num = parseInt(inputValue, 10);
    if (!isNaN(num) && num >= min && num <= max) {
      onConfirm(num);
    }
  }, [inputValue, min, max, onConfirm]);

  useModalKeyboard({ onEnter: !useButtons ? handleInputConfirm : undefined }, [
    useButtons,
    handleInputConfirm,
  ]);

  const numbers = useButtons ? Array.from({ length: range }, (_, i) => min + i) : [];

  return (
    <Modal maxWidth="max-w-sm" maxHeight="" className="outline-none">
      <div role="dialog" aria-modal="true" aria-labelledby="choose-number-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="choose-number-title" className="font-semibold text-base">
                Choose a Number
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
              <p className="text-xs text-muted-foreground">
                Between {min} and {max}
              </p>
            </div>
          </div>
        </Modal.Header>

        <Modal.Instructions>
          {useButtons ? "Click a number." : "Enter a number and confirm."}
        </Modal.Instructions>

        {useButtons ? (
          <div
            className="p-4 flex flex-wrap gap-2 justify-center"
            role="group"
            aria-label="Number choices"
          >
            {numbers.map((num) => (
              <button
                key={num}
                onClick={() => onConfirm(num)}
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
          <div className="p-4 flex items-center gap-2">
            <input
              ref={inputRef}
              type="number"
              min={min}
              max={max}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className={cn(MODAL_INPUT, "flex-1")}
            />
            <Button size="sm" onClick={handleInputConfirm}>
              Confirm
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
