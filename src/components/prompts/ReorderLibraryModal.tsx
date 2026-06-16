import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { Card } from "@/components/game/Card";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL, MODAL_FOOTER_BETWEEN } from "@/components/game/game.styles";
import { useState, useCallback } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { usePromptSourceCard } from "./internal/usePromptSourceCard";
import type { PromptProps } from "./internal/promptProps";
import type { ReorderLibraryInput, ReorderLibraryOutput } from "@/protocol";
import type { GameCard } from "@/types/manabrew";
import { cn } from "@/lib/utils";

const DECK_ZONES = ["Library", "PlanarDeck", "SchemeDeck", "AttractionDeck", "ContraptionDeck"];

export function ReorderLibraryModal({
  input,
  respond,
}: PromptProps<ReorderLibraryInput, ReorderLibraryOutput>) {
  const sourceCard = usePromptSourceCard();
  const cards = input.cards as GameCard[];
  const destination = input.destination;
  const topOfDeck = input.topOfDeck ?? true;
  const isDeck = !destination || DECK_ZONES.includes(destination);
  const title = isDeck
    ? topOfDeck
      ? "Reorder Top of Library"
      : "Order Cards for Bottom of Library"
    : `Order Cards — ${destination}`;
  // unsorted = cards not yet placed; sorted = placed in chosen order
  const [sorted, setSorted] = useState<GameCard[]>([]);
  const unsorted = cards.filter((c) => !sorted.some((s) => s.id === c.id));
  const allSorted = sorted.length === cards.length;

  const handleClickUnsorted = (card: GameCard) => {
    setSorted((prev) => [...prev, card]);
  };

  const handleClickSorted = (card: GameCard) => {
    // Remove from sorted (put back in unsorted)
    setSorted((prev) => prev.filter((c) => c.id !== card.id));
  };

  const handleReset = () => {
    setSorted([]);
  };

  // Convention: last element = top of library
  const handleConfirm = useCallback(() => {
    if (allSorted) {
      respond({ type: "reorderLibraryDecision", orderedCardIds: sorted.map((c) => c.id) });
    }
  }, [allSorted, sorted, respond]);

  useModalKeyboard({ onEnter: allSorted ? handleConfirm : undefined }, [allSorted, handleConfirm]);

  return (
    <Modal maxWidth="max-w-lg" maxHeight="">
      <Modal.Header>
        <div className="flex items-center gap-3">
          {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />}
          <div>
            <h2 className="font-semibold text-base">{title}</h2>
            <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
          </div>
        </div>
      </Modal.Header>

      <Modal.Instructions>
        {isDeck
          ? "Click cards in the order you want them. First clicked = closest to the bottom, last clicked = closest to the top."
          : "Click cards in the order they should be placed. First clicked = placed first."}
      </Modal.Instructions>

      <div className="p-4 space-y-4">
        {/* Unsorted cards */}
        {unsorted.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">Click to place:</p>
            <div className="flex gap-2 flex-wrap justify-center">
              {unsorted.map((card) => (
                <button
                  key={card.id}
                  onClick={() => handleClickUnsorted(card)}
                  className="cursor-pointer hover:ring-2 hover:ring-primary rounded transition-all"
                >
                  <Card card={card} />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Sorted cards */}
        {sorted.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              {isDeck ? "Library order (left = bottom, right = top):" : "Order (left = first):"}
            </p>
            <div className="flex gap-2 flex-wrap justify-center items-end">
              {sorted.map((card, i) => (
                <div key={card.id} className="flex flex-col items-center gap-1">
                  <span
                    className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded",
                      i === sorted.length - 1
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {isDeck
                      ? i === sorted.length - 1
                        ? "TOP"
                        : i === 0
                          ? "BTM"
                          : `${i + 1}`
                      : `${i + 1}`}
                  </span>
                  <button
                    onClick={() => handleClickSorted(card)}
                    className="cursor-pointer hover:ring-2 hover:ring-destructive rounded transition-all"
                    title="Click to remove"
                  >
                    <Card card={card} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={MODAL_FOOTER_BETWEEN}>
        <Button size="sm" variant="ghost" onClick={handleReset} disabled={sorted.length === 0}>
          Reset
        </Button>
        <Button size="sm" disabled={!allSorted} onClick={handleConfirm}>
          Confirm Order
        </Button>
      </div>
    </Modal>
  );
}
