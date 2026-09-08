import { Button } from "@/components/ui/button";
import { isFacelessCard } from "@/lib/gameCard";
import type { CardBrowserItem } from "./cardBrowser";

interface DialogCardBrowserActionTrayProps {
  active?: CardBrowserItem;
  selectedCount: number;
  pending: boolean;
  defaultActionLabel: string;
  actionLabel?: (item: CardBrowserItem) => string;
  onActivate: (item: CardBrowserItem) => void;
}

export function DialogCardBrowserActionTray({
  active,
  selectedCount,
  pending,
  defaultActionLabel,
  actionLabel,
  onActivate,
}: DialogCardBrowserActionTrayProps) {
  const name = active
    ? isFacelessCard(active.card)
      ? "Face-down card"
      : active.card.identity.name
    : "Select a card";
  const status = active
    ? active.selected
      ? "Selected"
      : active.legal
        ? "Available for this action"
        : "Unavailable for this action"
    : "Choose a card to continue";

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-3">
      <div className="min-w-40 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected · ${status}` : status}
        </p>
      </div>
      <Button
        disabled={pending || !active || (!active.legal && !active.selected)}
        onClick={() => {
          if (active && !pending && (active.legal || active.selected)) onActivate(active);
        }}
      >
        {pending
          ? "Waiting for response…"
          : active
            ? (actionLabel?.(active) ?? defaultActionLabel)
            : defaultActionLabel}
      </Button>
    </div>
  );
}
