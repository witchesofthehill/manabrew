import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CardInspectionState } from "./cardInspection";
import type { CardBrowserItem } from "./cardBrowser";
import { DialogCardInspector } from "./DialogCardInspector";

interface DialogCardBrowserInspectorPaneProps {
  active?: CardBrowserItem;
  inspection: CardInspectionState | null;
  open: boolean;
  desktop: boolean;
  pending: boolean;
  defaultActionLabel: string;
  searchHint: string;
  actionLabel?: (item: CardBrowserItem) => string;
  details?: (item: CardBrowserItem) => ReactNode;
  highlight?: (item: CardBrowserItem) => string;
  onClose: () => void;
  onInspectionChange: (state: CardInspectionState) => void;
  onActivate?: (item: CardBrowserItem) => void;
}

export function DialogCardBrowserInspectorPane({
  active,
  inspection,
  open,
  desktop,
  pending,
  defaultActionLabel,
  searchHint,
  actionLabel,
  details,
  highlight,
  onClose,
  onInspectionChange,
  onActivate,
}: DialogCardBrowserInspectorPaneProps) {
  return (
    <div
      className={cn(
        "min-h-0 overflow-y-auto overscroll-contain",
        open && active ? "block" : "hidden md:block",
      )}
    >
      {open && active && !desktop && (
        <Button variant="ghost" size="sm" className="mb-2 md:hidden" onClick={onClose}>
          Back to cards
        </Button>
      )}
      {active && inspection ? (
        <DialogCardInspector
          card={active.card}
          state={inspection}
          onChange={onInspectionChange}
          highlight={highlight?.(active)}
        >
          {details?.(active)}
          {onActivate && (
            <>
              <Button
                className="w-full whitespace-normal"
                disabled={pending || (!active.legal && !active.selected)}
                onClick={() => {
                  if (!pending && (active.legal || active.selected)) onActivate(active);
                }}
              >
                {pending ? "Waiting for response…" : (actionLabel?.(active) ?? defaultActionLabel)}
              </Button>
              {!active.legal && !active.selected && (
                <p className="text-xs text-muted-foreground">
                  This card can be inspected, but is not available for this action.
                </p>
              )}
            </>
          )}
        </DialogCardInspector>
      ) : (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Focus, hover or tap a card to inspect it. Arrow keys browse{searchHint}.
        </p>
      )}
    </div>
  );
}
