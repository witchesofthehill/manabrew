import { useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";
import { cn } from "@/lib/utils";

function cardCounts(deck: EditorDeck): Map<string, number> {
  const counts = new Map<string, number>();
  const cards: DeckCard[] = [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.maybeboard ?? []),
    ...(deck.commanders ?? []),
  ];
  for (const card of cards) {
    counts.set(card.identity.name, (counts.get(card.identity.name) ?? 0) + 1);
  }
  return counts;
}

export function DeckChangeSummary({
  currentDeck,
  savedSnapshot,
}: {
  currentDeck: EditorDeck;
  savedSnapshot: string;
}) {
  const [open, setOpen] = useState(false);
  const changes = useMemo(() => {
    const savedDeck = JSON.parse(savedSnapshot) as EditorDeck;
    const before = cardCounts(savedDeck);
    const after = cardCounts(currentDeck);
    return [...new Set([...before.keys(), ...after.keys()])]
      .map((name) => ({ name, delta: (after.get(name) ?? 0) - (before.get(name) ?? 0) }))
      .filter((change) => change.delta !== 0)
      .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
  }, [currentDeck, savedSnapshot]);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 text-xs"
        disabled={changes.length === 0}
        onClick={() => setOpen(true)}
      >
        <GitCompareArrows className="h-3.5 w-3.5" />
        {changes.length > 0 ? `${changes.length} changes` : "No changes"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Changes since last save</DialogTitle>
            <DialogDescription>Card quantity changes across the open deck.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {changes.map((change) => (
              <div
                key={change.name}
                className="flex min-h-9 items-center justify-between rounded-md px-2 text-sm odd:bg-muted/40"
              >
                <span className="truncate">{change.name}</span>
                <span className={cn(change.delta > 0 ? "text-legality-legal" : "text-destructive")}>
                  {change.delta > 0 ? "+" : ""}
                  {change.delta}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
