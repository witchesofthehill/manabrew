import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/game/modals/Modal";
import { TextWithMana } from "@/components/game/TextWithMana";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL, MODAL_FOOTER_BETWEEN } from "@/components/game/game.styles";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ChooseModeInput, ChooseModeOutput } from "@/protocol";

export function ChooseModeModal({
  input,
  respond,
}: PromptProps<ChooseModeInput, ChooseModeOutput>) {
  const { options, minChoices, maxChoices } = input;
  const sourceCard = usePromptSourceCard();
  const sourceLabel = input.sourceCardName ?? undefined;
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // If exactly 1 must be picked and max 1 can be picked, auto-confirm on click.
  const isAutoConfirm = maxChoices === 1 && minChoices === 1;
  const showCheckboxes = maxChoices > 1;
  const canConfirm = selected.size >= minChoices && selected.size <= maxChoices;

  // Auto-focus the dialog container for keyboard accessibility.
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, [options]);

  const handleConfirm = useCallback(() => {
    respond({ type: "modeDecision", chosenIndices: [...selected].sort((a, b) => a - b) });
  }, [selected, respond]);

  function toggleOption(idx: number) {
    if (isAutoConfirm) {
      respond({ type: "modeDecision", chosenIndices: [idx] });
      return;
    }

    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        // If it's a single choice (up to 1), clicking a new one replaces the old one
        if (maxChoices === 1) {
          return new Set([idx]);
        }
        if (next.size >= maxChoices) return prev;
        next.add(idx);
      }
      return next;
    });
  }

  const spaceConfirms = canConfirm && !isAutoConfirm && !(minChoices === 0 && selected.size === 0);
  useModalKeyboard(
    {
      onEnter: canConfirm && !isAutoConfirm ? handleConfirm : undefined,
      onSpace: spaceConfirms ? handleConfirm : undefined,
    },
    [canConfirm, isAutoConfirm, spaceConfirms, handleConfirm],
  );

  const subtitle =
    minChoices === maxChoices
      ? `Choose ${minChoices} mode${minChoices !== 1 ? "s" : ""}`
      : `Choose ${minChoices}–${maxChoices} modes`;

  return (
    <Modal maxWidth="max-w-md" maxHeight="" className="outline-none">
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-mode-title"
      >
        <Modal.Header>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {sourceCard && (
                <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
              )}
              <div>
                <h2 id="choose-mode-title" className="font-semibold text-base">
                  Choose Mode
                </h2>
                {(sourceCard?.name ?? sourceLabel) && (
                  <p className="text-xs text-muted-foreground font-medium">
                    {sourceCard?.name ?? sourceLabel}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              </div>
            </div>
            {!isAutoConfirm && (
              <Badge variant={canConfirm ? "default" : "secondary"} aria-live="polite">
                {selected.size} / {maxChoices} selected
              </Badge>
            )}
          </div>
        </Modal.Header>

        <Modal.Instructions>
          {isAutoConfirm
            ? "Click a mode to resolve it."
            : "Select the modes you want to resolve, then confirm."}
        </Modal.Instructions>

        {/* Mode list */}
        <div
          className="p-4 flex flex-col gap-2 max-h-[60vh] overflow-y-auto"
          role="group"
          aria-label="Available modes"
        >
          {options.map((desc, idx) => {
            const isSelected = selected.has(idx);
            const isDisabled =
              !isAutoConfirm && !isSelected && selected.size >= maxChoices && maxChoices > 1;

            return (
              <button
                key={idx}
                onClick={() => toggleOption(idx)}
                disabled={isDisabled}
                aria-pressed={showCheckboxes ? isSelected : undefined}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-lg border text-sm font-medium transition-all group",
                  "hover:border-primary/50",
                  "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border",
                  isSelected
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border bg-background hover:bg-muted/50",
                )}
              >
                <span className="flex items-start gap-3">
                  {showCheckboxes && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors",
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground group-hover:border-primary/50",
                      )}
                    >
                      {isSelected && (
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={3}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                  )}
                  <span className="leading-tight">
                    <TextWithMana text={desc} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer — only shown when we don't auto-confirm */}
        {!isAutoConfirm && (
          <div className={MODAL_FOOTER_BETWEEN}>
            <span className="text-xs text-muted-foreground text-left leading-tight max-w-[200px]">
              {minChoices === 0
                ? "Choosing a mode is optional."
                : `You must select at least ${minChoices}.`}
            </span>
            <Button
              size="sm"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="min-w-[100px] shrink-0"
            >
              {minChoices === 0 && selected.size === 0
                ? "Skip"
                : `Confirm ${selected.size > 0 ? `(${selected.size})` : ""}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
