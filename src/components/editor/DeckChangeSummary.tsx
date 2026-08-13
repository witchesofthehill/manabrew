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
import { deckOwnershipByName } from "@/lib/collection";
import { useCollectionStore } from "@/stores/useCollectionStore";

function coverageShortage(deck: EditorDeck, quantities: Record<string, number>): number {
  return [
    ...deckOwnershipByName(quantities, [
      ...deck.cards,
      ...deck.sideboard,
      ...(deck.commanders ?? []),
    ]).values(),
  ].reduce((total, ownership) => total + ownership.shortage, 0);
}

function cardCounts(deck: EditorDeck): Map<string, number> {
  const counts = new Map<string, number>();
  const cards: DeckCard[] = [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.maybeboard ?? []),
    ...(deck.commanders ?? []),
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
  ];
  for (const card of cards) {
    counts.set(card.identity.name, (counts.get(card.identity.name) ?? 0) + 1);
  }
  return counts;
}

function cardLocations(deck: EditorDeck): Map<string, string> {
  const locations = new Map<string, string>();
  for (const [zone, cards] of [
    ["main", deck.cards],
    ["sideboard", deck.sideboard],
    ["maybeboard", deck.maybeboard ?? []],
    ["command zone", deck.commanders ?? []],
  ] as const) {
    for (const card of cards) locations.set(card.identity.name, zone);
  }
  return locations;
}

function printingKeys(deck: EditorDeck): Map<string, string> {
  return new Map(
    [...deck.cards, ...deck.sideboard, ...(deck.maybeboard ?? []), ...(deck.commanders ?? [])].map(
      (card) => [
        card.identity.name,
        `${card.identity.setCode}:${card.identity.cardNumber}:${card.identity.foil ? "foil" : "nonfoil"}`,
      ],
    ),
  );
}

export function DeckChangeSummary({
  currentDeck,
  savedSnapshot,
}: {
  currentDeck: EditorDeck;
  savedSnapshot: string;
}) {
  const [open, setOpen] = useState(false);
  const quantities = useCollectionStore((state) => state.quantities);
  const changes = useMemo(() => {
    const savedDeck = JSON.parse(savedSnapshot) as EditorDeck;
    const before = cardCounts(savedDeck);
    const after = cardCounts(currentDeck);
    const quantityChanges = [...new Set([...before.keys(), ...after.keys()])]
      .map((name) => ({ name, delta: (after.get(name) ?? 0) - (before.get(name) ?? 0) }))
      .filter((change) => change.delta !== 0)
      .sort((a, b) => b.delta - a.delta || a.name.localeCompare(b.name));
    const beforeLocations = cardLocations(savedDeck);
    const afterLocations = cardLocations(currentDeck);
    const moves = [...afterLocations].flatMap(([name, location]) => {
      const beforeLocation = beforeLocations.get(name);
      return beforeLocation && beforeLocation !== location
        ? [{ name, from: beforeLocation, to: location }]
        : [];
    });
    const beforePrintings = printingKeys(savedDeck);
    const printings = [...printingKeys(currentDeck)].flatMap(([name, printing]) =>
      beforePrintings.has(name) && beforePrintings.get(name) !== printing ? [{ name }] : [],
    );
    return {
      quantityChanges,
      moves,
      printings,
      coverageDelta:
        coverageShortage(currentDeck, quantities) - coverageShortage(savedDeck, quantities),
    };
  }, [currentDeck, quantities, savedSnapshot]);
  const changeCount =
    changes.quantityChanges.length +
    changes.moves.length +
    changes.printings.length +
    Number(changes.coverageDelta !== 0);

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 gap-1 text-xs"
        disabled={changeCount === 0}
        onClick={() => setOpen(true)}
      >
        <GitCompareArrows className="h-3.5 w-3.5" />
        {changeCount > 0 ? `${changeCount} changes` : "No changes"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Changes since last save</DialogTitle>
            <DialogDescription>Card quantity changes across the open deck.</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {changes.coverageDelta !== 0 && (
              <div className="mb-2 rounded-md border px-2 py-2 text-sm">
                Collection shortage
                <span
                  className={cn(
                    "ml-2 font-mono",
                    changes.coverageDelta < 0 ? "text-legality-legal" : "text-warning",
                  )}
                >
                  {changes.coverageDelta > 0 ? "+" : ""}
                  {changes.coverageDelta}
                </span>
              </div>
            )}
            {changes.moves.map((change) => (
              <div
                key={`move-${change.name}`}
                className="rounded-md px-2 py-1.5 text-sm odd:bg-muted/40"
              >
                <span className="font-medium">{change.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {change.from} → {change.to}
                </span>
              </div>
            ))}
            {changes.printings.map((change) => (
              <div
                key={`print-${change.name}`}
                className="rounded-md px-2 py-1.5 text-sm odd:bg-muted/40"
              >
                <span className="font-medium">{change.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">printing changed</span>
              </div>
            ))}
            {changes.quantityChanges.map((change) => (
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
