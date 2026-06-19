import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/game/modals/Modal";
import { Card } from "@/components/game/Card";
import { cn } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef } from "react";
import type { GameCard } from "@/types/manabrew";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { MODAL_FOOTER_BETWEEN } from "@/components/game/game.styles";
import { ModalCardFilter } from "@/components/game/modals/ModalCardFilter";
import { useCardNameFilter } from "@/components/game/modals/useCardNameFilter";

interface ChooseCardsModalProps {
  cards: GameCard[];
  minChoices: number;
  maxChoices: number;
  sourceCardName?: string;
  /** Optional description shown below the card name (e.g. remaining cost for Convoke/Improvise). */
  description?: string;
  /** The whole choice may be declined; a non-empty pick still honors minChoices. */
  optional?: boolean;
  onConfirm: (chosenCardIds: string[]) => void;
}

export function CardListModal({
  cards,
  minChoices,
  maxChoices,
  sourceCardName,
  description,
  optional = false,
  onConfirm,
}: ChooseCardsModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const isAutoConfirm = maxChoices === 1 && minChoices === 1 && !optional;
  const canConfirm =
    (selected.size >= minChoices && selected.size <= maxChoices) ||
    (optional && selected.size === 0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const { query, setQuery, filtered, showFilter } = useCardNameFilter(cards);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [cards]);

  const handleConfirm = useCallback(() => {
    onConfirm([...selected]);
  }, [selected, onConfirm]);

  function toggleCard(cardId: string) {
    if (isAutoConfirm) {
      onConfirm([cardId]);
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        if (maxChoices === 1) {
          return new Set([cardId]);
        }
        if (next.size >= maxChoices) return prev;
        next.add(cardId);
      }
      return next;
    });
  }

  const spaceConfirms =
    canConfirm && !isAutoConfirm && !((minChoices === 0 || optional) && selected.size === 0);
  useModalKeyboard(
    {
      onEnter: canConfirm && !isAutoConfirm ? handleConfirm : undefined,
      onSpace: spaceConfirms ? handleConfirm : undefined,
    },
    [canConfirm, isAutoConfirm, spaceConfirms, handleConfirm],
  );

  const subtitle =
    minChoices === maxChoices
      ? `Choose ${minChoices} card${minChoices !== 1 ? "s" : ""}`
      : `Choose ${minChoices}–${maxChoices} cards`;

  return (
    <Modal maxWidth="max-w-2xl" maxHeight="max-h-[80vh]" className="outline-none">
      <div ref={dialogRef} tabIndex={-1} className="outline-none" role="dialog" aria-modal="true">
        <Modal.Header>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-base">Choose Cards</h2>
              {sourceCardName && (
                <p className="text-xs text-muted-foreground font-medium">{sourceCardName}</p>
              )}
              {description && <p className="text-xs text-muted-foreground">{description}</p>}
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
            {!isAutoConfirm && (
              <Badge variant={canConfirm ? "default" : "secondary"}>
                {selected.size} / {maxChoices} selected
              </Badge>
            )}
          </div>
        </Modal.Header>

        <Modal.Instructions>
          {isAutoConfirm
            ? "Click a card to choose it."
            : "Select the cards you want, then confirm."}
        </Modal.Instructions>

        {showFilter && <ModalCardFilter value={query} onChange={setQuery} />}

        <div className="p-4 overflow-y-auto max-h-[50vh]">
          {cards.length === 0 ? (
            <Modal.EmptyState message="No valid cards" />
          ) : filtered.length === 0 ? (
            <Modal.EmptyState message="No matching cards" />
          ) : (
            <div className="flex flex-wrap gap-2 justify-center">
              {filtered.map((card) => {
                const isSelected = selected.has(card.id);
                return (
                  <div
                    key={card.id}
                    onClick={() => toggleCard(card.id)}
                    className={cn(
                      "cursor-pointer transition-all rounded-lg",
                      isSelected
                        ? "ring-2 ring-primary scale-105"
                        : "hover:ring-1 hover:ring-primary/50 hover:scale-[1.02]",
                    )}
                  >
                    <Card card={card} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {cards.length === 0 ? (
          <div className={MODAL_FOOTER_BETWEEN}>
            <span className="text-xs text-muted-foreground text-left leading-tight max-w-[200px]">
              No cards available to choose.
            </span>
            <Button size="sm" onClick={() => onConfirm([])} className="min-w-[100px] shrink-0">
              Done
            </Button>
          </div>
        ) : !isAutoConfirm ? (
          <div className={MODAL_FOOTER_BETWEEN}>
            <span className="text-xs text-muted-foreground text-left leading-tight max-w-[200px]">
              {minChoices === 0 || optional
                ? "Choosing is optional."
                : `You must select at least ${minChoices}.`}
            </span>
            <Button
              size="sm"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="min-w-[100px] shrink-0"
            >
              {(minChoices === 0 || optional) && selected.size === 0
                ? "Skip"
                : `Confirm ${selected.size > 0 ? `(${selected.size})` : ""}`}
            </Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
