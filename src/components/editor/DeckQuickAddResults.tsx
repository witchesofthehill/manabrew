import { MoreHorizontal, Plus } from "lucide-react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { cn } from "@/lib/utils";
import type { ScryfallCard } from "@/types/scryfall";

interface DeckQuickAddResultsProps {
  results: ScryfallCard[];
  activeIndex: number;
  recentlyAddedId: string | null;
  onActiveIndexChange: (index: number) => void;
  onQuickAdd: (card: ScryfallCard) => void;
  onOptions: (card: ScryfallCard) => void;
  getCount: (cardName: string) => number;
}

export function DeckQuickAddResults({
  results,
  activeIndex,
  recentlyAddedId,
  onActiveIndexChange,
  onQuickAdd,
  onOptions,
  getCount,
}: DeckQuickAddResultsProps) {
  return (
    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 min-w-[300px] overflow-y-auto rounded-md border bg-popover shadow-lg">
      <div className="sticky top-0 z-10 border-b bg-popover px-2 py-1 text-[10px] text-muted-foreground">
        Click or press Enter to add one to the main deck
      </div>
      {results.map((card, index) => {
        const thumbnail = card.image_uris?.small ?? card.card_faces?.[0]?.image_uris?.small;
        return (
          <div
            key={card.id}
            className={cn(
              "flex items-center border-b border-border/30 transition-colors last:border-0 hover:bg-muted",
              activeIndex === index && "bg-muted",
              recentlyAddedId === card.id && "bg-primary/15",
            )}
            onMouseEnter={() => onActiveIndexChange(index)}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
              title={`Add one ${card.name} to main deck`}
              onClick={() => onQuickAdd(card)}
            >
              {thumbnail && (
                <ScryfallImg
                  src={thumbnail}
                  alt=""
                  className="h-11 w-8 shrink-0 rounded object-cover object-top"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{card.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {getCount(card.name)} in deck
              </span>
              <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            </button>
            <button
              type="button"
              className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title={`More ways to add ${card.name}`}
              onClick={() => onOptions(card)}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
