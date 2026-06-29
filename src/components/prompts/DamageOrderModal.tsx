import { Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { cn } from "@/lib/utils";
import type { CardDto } from "@/protocol/game";

interface DamageOrderModalProps {
  attackerName: string;
  blockerCards: CardDto[];
  order: string[];
  isWaiting: boolean;
  onToggle: (cardId: string) => void;
  onUndo: () => void;
  onAuto: () => void;
  onConfirm: () => void;
}

export function DamageOrderModal({
  attackerName,
  blockerCards,
  order,
  isWaiting,
  onToggle,
  onUndo,
  onAuto,
  onConfirm,
}: DamageOrderModalProps) {
  const isComplete = order.length >= blockerCards.length && blockerCards.length > 0;

  return (
    <Modal maxWidth="max-w-md" className="outline-none">
      <Modal.Header>
        <h2 className="text-base font-semibold">Order Combat Damage</h2>
        <p className="text-xs text-muted-foreground">
          {attackerName} is blocked by {blockerCards.length} creatures — choose the order it assigns
          damage.
        </p>
      </Modal.Header>

      <div className="mt-4 flex flex-col gap-3 px-4 pb-4">
        <p className="text-xs italic text-muted-foreground">
          {order.length === 0
            ? "Click blockers in the order damage is dealt."
            : isComplete
              ? "Order set — confirm to deal damage."
              : `Click the next blocker (${order.length}/${blockerCards.length}).`}
        </p>
        <div className="flex flex-wrap gap-2">
          {blockerCards.map((c) => {
            const idx = order.indexOf(c.id);
            const ordered = idx >= 0;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                disabled={isWaiting}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                  ordered
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border hover:bg-accent",
                )}
              >
                {ordered && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                    {idx + 1}
                  </span>
                )}
                <span className="truncate">{c.identity.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex justify-between pt-1">
          <Button size="sm" variant="ghost" onClick={onAuto} disabled={isWaiting}>
            Auto
          </Button>
          <div className="flex gap-2">
            {order.length > 0 && (
              <Button size="sm" variant="outline" onClick={onUndo} disabled={isWaiting}>
                Undo
              </Button>
            )}
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={isWaiting || !isComplete}
              className="gap-1.5"
            >
              <Swords className="h-3.5 w-3.5" />
              Confirm
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
