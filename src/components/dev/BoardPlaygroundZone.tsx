import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogCardBrowser } from "@/components/game/modals/DialogCardBrowser";
import type { ZoneDto } from "@/protocol/game";

interface BoardPlaygroundZoneProps {
  zone: ZoneDto;
  actionableCardIds: string[];
  onClose: () => void;
}

export function BoardPlaygroundZone({
  zone,
  actionableCardIds,
  onClose,
}: BoardPlaygroundZoneProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const items = zone.cards
    .filter((card) => card.visibility === "visible")
    .map((card) => ({
      id: card.id,
      card,
      legal: actionableCardIds.includes(card.id),
      selected: selectedId === card.id,
    }));
  const actionableCount = items.filter((item) => item.legal).length;
  return (
    <section
      aria-label={`${zone.zone} color preview`}
      className="flex h-[48%] min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <h3 className="text-sm font-medium capitalize">{zone.zone}</h3>
          <p className="text-xs text-muted-foreground">
            {actionableCount} actionable · {items.length - actionableCount} browse-only.
            <span className="hidden md:inline">
              {" "}
              Click an actionable card to toggle its selection.
            </span>
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close zone
        </Button>
      </div>
      <DialogCardBrowser
        items={items}
        picker
        compact
        activateOnClick
        onActivate={(item) => setSelectedId((current) => (current === item.id ? null : item.id))}
        defaultActionLabel="Select card"
      />
    </section>
  );
}
