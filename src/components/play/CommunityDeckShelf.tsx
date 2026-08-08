import { ChevronDown } from "lucide-react";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { DeckShelfRow } from "@/components/play/DeckShelfRow";
import { Button } from "@/components/ui/button";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { availableEngines } from "@/lib/engines";
import { cn } from "@/lib/utils";

const SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

interface CommunityDeckShelfProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDeck: (id: string) => void;
  onAuthorClick: (author: string) => void;
}

export function CommunityDeckShelf({
  open,
  onOpenChange,
  onOpenDeck,
  onAuthorClick,
}: CommunityDeckShelfProps) {
  const { decks, loading, error, retry } = useHubDeckSearch(
    "",
    undefined,
    open,
    availableEngines(),
    "community",
  );

  return (
    <div className="border-t border-border/70 pt-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      >
        <span>
          <span className="text-sm font-semibold">Community decks</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {loading ? "Loading…" : decks.length}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-3">
          {error ? (
            <div className="flex items-center gap-2 px-2 text-xs text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              <Button variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : decks.length > 0 ? (
            <DeckShelfRow label="Community decks">
              {decks.map((entry) => (
                <div key={entry.id} className={SHELF_CARD_CLASS}>
                  <DeckHubEntryCard
                    entry={entry}
                    onOpen={() => onOpenDeck(entry.id)}
                    onAuthorClick={() => onAuthorClick(entry.author)}
                  />
                </div>
              ))}
            </DeckShelfRow>
          ) : (
            <p className="px-2 text-xs italic text-muted-foreground">
              {loading ? "Loading Community decks…" : "No Community decks are available."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
