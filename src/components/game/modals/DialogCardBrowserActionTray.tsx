import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isFacelessCard } from "@/lib/gameCard";
import { animationsEnabled } from "@/pixi/effects/enabled";
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
  const details = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = details.current;
    if (!node || !animationsEnabled()) return;
    const animation = node.animate(
      [
        { opacity: 0.45, transform: "translateY(2px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 120, easing: "cubic-bezier(0.16,1,0.3,1)" },
    );
    return () => animation.cancel();
  }, [active?.id, name, selectedCount, status]);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-3">
      <div ref={details} className="min-w-40 flex-1" aria-live="polite">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected · ${status}` : status}
        </p>
      </div>
      <Button
        className="min-w-48"
        disabled={pending || !active || (!active.legal && !active.selected)}
        onClick={() => {
          if (active && !pending && (active.legal || active.selected)) onActivate(active);
        }}
      >
        {pending && <LoaderCircle className={cn(animationsEnabled() && "animate-spin")} />}
        {pending
          ? "Waiting for response…"
          : active
            ? (actionLabel?.(active) ?? defaultActionLabel)
            : defaultActionLabel}
      </Button>
    </div>
  );
}
