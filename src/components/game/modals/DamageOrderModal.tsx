import { Button } from "@/components/ui/button";
import { Modal } from "./Modal";
import { cn } from "@/lib/utils";
import { useState, useCallback, useRef, useEffect } from "react";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { GameCard } from "@/types/manabrew";

interface DamageOrderModalProps {
  /** Attacker card ID (to show which attacker this is for). */
  attackerId?: string;
  /** Blocker IDs in their default order. */
  blockerIds: string[];
  /** Blocker card data for display. */
  blockerCards: GameCard[];
  /** All cards from the game view (to look up blocker/attacker info). */
  gameViewCards?: GameCard[];
  onConfirm: (orderedBlockerIds: string[]) => void;
}

export function DamageOrderModal({
  attackerId,
  blockerIds,
  blockerCards,
  gameViewCards,
  onConfirm,
}: DamageOrderModalProps) {
  const [ordered, setOrdered] = useState<string[]>([]);

  const remaining = blockerIds.filter((id) => !ordered.includes(id));
  const isComplete = ordered.length === blockerIds.length;

  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, [blockerIds]);

  const handleConfirm = useCallback(() => {
    if (isComplete) {
      onConfirm(ordered);
    }
  }, [isComplete, ordered, onConfirm]);

  const handleDefault = useCallback(() => {
    onConfirm(blockerIds);
  }, [blockerIds, onConfirm]);

  useModalKeyboard({ onEnter: isComplete ? handleConfirm : undefined }, [
    isComplete,
    handleConfirm,
  ]);

  function addToOrder(id: string) {
    setOrdered((prev) => [...prev, id]);
  }

  function undoLast() {
    setOrdered((prev) => prev.slice(0, -1));
  }

  function getCardInfo(id: string): { name: string; power: string; toughness: string } {
    const card = blockerCards.find((c) => c.id === id) ?? gameViewCards?.find((c) => c.id === id);
    if (card) {
      return {
        name: card.name,
        power: String(card.power ?? "?"),
        toughness: String(card.toughness ?? "?"),
      };
    }
    return { name: `Card #${id}`, power: "?", toughness: "?" };
  }

  return (
    <Modal maxWidth="max-w-sm" maxHeight="" className="outline-none">
      <div ref={dialogRef} tabIndex={-1} className="outline-none" role="dialog" aria-modal="true">
        <Modal.Header>
          <h2 className="font-semibold text-base">Damage Assignment Order</h2>
          {attackerId &&
            (() => {
              const attacker = gameViewCards?.find((c) => c.id === attackerId);
              return attacker ? (
                <p className="text-xs text-muted-foreground">
                  Order blockers for{" "}
                  <span className="font-semibold text-foreground">{attacker.name}</span>
                </p>
              ) : null;
            })()}
          <p className="text-xs text-muted-foreground">
            Click blockers in the order damage should be assigned (first receives damage first).
          </p>
        </Modal.Header>

        {/* Already ordered */}
        {ordered.length > 0 && (
          <div className="px-4 pt-3">
            <p className="text-xs text-muted-foreground mb-1">Assignment order:</p>
            <div className="flex flex-col gap-1">
              {ordered.map((id, idx) => {
                const info = getCardInfo(id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/30 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground w-4">{idx + 1}.</span>
                    <span className="font-medium">{info.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {info.power}/{info.toughness}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Remaining to assign */}
        {remaining.length > 0 && (
          <div className="p-4 flex flex-col gap-1" role="group" aria-label="Remaining blockers">
            <p className="text-xs text-muted-foreground mb-1">
              {ordered.length === 0 ? "Click to assign order:" : "Remaining:"}
            </p>
            {remaining.map((id) => {
              const info = getCardInfo(id);
              return (
                <button
                  key={id}
                  onClick={() => addToOrder(id)}
                  className={cn(
                    "w-full text-left px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                    "border-border bg-background hover:bg-muted/50 hover:border-primary/50",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span>{info.name}</span>
                    <span className="text-xs text-muted-foreground ml-auto">
                      {info.power}/{info.toughness}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-between px-4 pb-4 pt-2">
          <div className="flex gap-2">
            {ordered.length > 0 && (
              <Button size="sm" variant="outline" onClick={undoLast}>
                Undo
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={handleDefault}>
              Default
            </Button>
          </div>
          <Button
            size="sm"
            disabled={!isComplete}
            onClick={handleConfirm}
            className="min-w-[100px]"
          >
            Confirm
          </Button>
        </div>
      </div>
    </Modal>
  );
}
