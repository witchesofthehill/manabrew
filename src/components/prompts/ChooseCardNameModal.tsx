import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import {
  MODAL_CARD_THUMBNAIL,
  MODAL_INPUT,
  MODAL_LIST_BUTTON,
} from "@/components/game/game.styles";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseCardNameInput, ChooseCardNameOutput } from "@/protocol";

export function ChooseCardNameModal({
  input,
  respond,
}: PromptProps<ChooseCardNameInput, ChooseCardNameOutput>) {
  const { validNames } = input;
  const sourceCard = usePromptSourceCard();
  const [filter, setFilter] = useState("");
  const [textInput, setTextInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hasList = validNames.length > 0;

  useEffect(() => {
    inputRef.current?.focus();
  }, [validNames]);

  const filtered =
    hasList && filter
      ? validNames.filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
      : validNames;

  const handleTextConfirm = useCallback(() => {
    if (textInput.trim()) {
      respond({ type: "cardNameDecision", chosenName: textInput.trim() });
    }
  }, [textInput, respond]);

  useModalKeyboard({ onEnter: !hasList ? handleTextConfirm : undefined }, [
    hasList,
    handleTextConfirm,
  ]);

  return (
    <Modal maxWidth="max-w-md" maxHeight="" className="outline-none">
      <div role="dialog" aria-modal="true" aria-labelledby="choose-card-name-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="choose-card-name-title" className="font-semibold text-base">
                Name a Card
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
            </div>
          </div>
        </Modal.Header>

        <Modal.Instructions>
          {hasList ? "Choose a card name from the list." : "Type a card name."}
        </Modal.Instructions>

        {hasList ? (
          <>
            {validNames.length > 10 && (
              <div className="px-4 pb-2">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Filter names..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className={MODAL_INPUT}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </div>
            )}
            <div
              className="p-4 flex flex-col gap-1.5 max-h-[50vh] overflow-y-auto"
              role="group"
              aria-label="Card name choices"
            >
              {filtered.map((name) => (
                <button
                  key={name}
                  onClick={() => respond({ type: "cardNameDecision", chosenName: name })}
                  className={MODAL_LIST_BUTTON}
                >
                  {name}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground">No matching names.</p>
              )}
            </div>
          </>
        ) : (
          <div className="p-4 flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              placeholder="Card name..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              className={cn(MODAL_INPUT, "flex-1")}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <Button size="sm" onClick={handleTextConfirm} disabled={!textInput.trim()}>
              Confirm
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
