import { MoreHorizontal, Plus } from "lucide-react";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { cn } from "@/lib/utils";
import { scryfallDisplayName, scryfallToDeckCard } from "@/lib/scryfall.utils";
import { chooseImageUrisForCard } from "@/stores/useScryfallStore";
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
    <div className="absolute right-0 top-full z-50 mt-1 max-h-[min(24rem,60dvh)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border bg-popover shadow-lg">
      <div className="sticky top-0 z-10 border-b bg-popover px-2 py-1 text-ui-meta text-muted-foreground">
        Click or press Enter to add one to the main deck
      </div>
      {results.map((card, index) => {
        const displayName = scryfallDisplayName(card);
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
              className="touch:min-w-11 touch:min-h-11 flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
              title={`Add one ${displayName} to main deck`}
              onClick={() => onQuickAdd(card)}
            >
              {chooseImageUrisForCard(card, { frontOnly: true }) && (
                <GeneratedCardImage
                  deckCard={scryfallToDeckCard(card)}
                  className="h-11 w-8 shrink-0 rounded"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-ui-label font-medium">
                {displayName}
              </span>
              <span className="shrink-0 text-ui-meta text-muted-foreground">
                {getCount(card.name)} in deck
              </span>
              <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
            </button>
            <button
              type="button"
              className="touch:min-w-11 touch:min-h-11 mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
              title={`More ways to add ${displayName}`}
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
