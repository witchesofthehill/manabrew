import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { cn } from "@/lib/utils";
import { scryfallDisplayName, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { chooseImageUrisForCard } from "@/stores/useScryfallStore";
import type { ScryfallCard } from "@/types/scryfall";
import type { DeckQuickAddRequest } from "./deckQuickAdd.parser";

interface DeckQuickAddResultsProps {
  results: ScryfallCard[];
  status: "loading" | "error" | "ready";
  request: DeckQuickAddRequest;
  activeIndex: number;
  recentlyAddedId: string | null;
  onActiveIndexChange: (index: number) => void;
  onQuickAdd: (card: ScryfallCard) => void;
  onOptions: (card: ScryfallCard) => void;
  onRetry: () => void;
  getCount: (cardName: string) => number;
}

export function DeckQuickAddResults({
  results,
  status,
  request,
  activeIndex,
  recentlyAddedId,
  onActiveIndexChange,
  onQuickAdd,
  onOptions,
  onRetry,
  getCount,
}: DeckQuickAddResultsProps) {
  const activeRowRef = useRef<HTMLDivElement>(null);
  const destination = { main: "main deck", side: "sideboard", maybe: "maybeboard" }[
    request.destination
  ];
  const needsOptions =
    request.quantity > 1 || request.destination !== "main" || request.tags.length > 0;
  const action = needsOptions
    ? `Review ${request.quantity} for ${destination}`
    : "Add 1 to main deck";
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, results]);

  return (
    <div>
      <div className="border-b px-2 py-1.5 text-ui-meta text-muted-foreground">
        {needsOptions
          ? "Select a card to review quantity, destination and tags."
          : "Press Enter or tap a card to add 1 to the main deck."}
      </div>
      {status === "loading" ? (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-4 text-ui-label text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />
          Searching card names…
        </div>
      ) : status === "error" ? (
        <div role="status" className="space-y-2 px-3 py-4">
          <p className="text-ui-label">
            Card search failed. Check the name or your connection, then try again.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry search
          </Button>
        </div>
      ) : results.length === 0 ? (
        <div role="status" className="px-3 py-4 text-ui-label text-muted-foreground">
          No cards found. Check the name or try fewer words.
        </div>
      ) : (
        results.map((card, index) => {
          const displayName = scryfallDisplayName(card);
          return (
            <div
              key={card.id}
              ref={activeIndex === index ? activeRowRef : null}
              className={cn(
                "flex items-center border-b border-border/30 transition-colors last:border-0 hover:bg-muted",
                activeIndex === index && "bg-muted",
                recentlyAddedId === card.id && "bg-primary/15",
              )}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") onActiveIndexChange(index);
              }}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-2 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring touch:min-h-11 touch:min-w-11"
                title={`${action}: ${displayName}`}
                onFocus={() => onActiveIndexChange(index)}
                onClick={() => onQuickAdd(card)}
              >
                {chooseImageUrisForCard(card, { frontOnly: true }) && (
                  <GeneratedCardImage
                    deckCard={scryfallToDeckCard(card)}
                    className="h-11 w-8 shrink-0 rounded"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-ui-label font-medium">{displayName}</span>
                  <span className="block text-ui-meta text-muted-foreground">
                    {getCount(card.name)} in main deck
                  </span>
                  <span className="block text-ui-meta text-primary">{action}</span>
                </span>
                <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
              </button>
              <button
                type="button"
                className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring touch:min-h-11 touch:min-w-11"
                title={`Quantity, destination and tags for ${displayName}`}
                onFocus={() => onActiveIndexChange(index)}
                onClick={() => onOptions(card)}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })
      )}
      <div className="space-y-1 border-t px-2 py-1.5 text-ui-meta text-muted-foreground">
        <p>
          ↑↓ select. Shift+Enter adds 1 to sideboard. Alt+Enter adds 1 to maybeboard. Esc closes.
        </p>
        <p>Set options by typing 3 Card Name &gt;side #tag.</p>
      </div>
    </div>
  );
}
