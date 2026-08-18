import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { CollapsibleDeckShelf } from "@/components/play/CollapsibleDeckShelf";
import { DECK_SHELF_CARD_CLASS, DeckShelfRow } from "@/components/play/DeckShelfRow";
import { Button } from "@/components/ui/button";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { availableEngines } from "@/lib/engines";

interface CommunityDeckShelfProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenDeck: (id: string) => void;
  onAuthorClick: (author: string) => void;
  onPlayDeck: (id: string) => void;
  pendingDeckId: string | null;
}

export function CommunityDeckShelf({
  open,
  onOpenChange,
  onOpenDeck,
  onAuthorClick,
  onPlayDeck,
  pendingDeckId,
}: CommunityDeckShelfProps) {
  const { decks, loading, error, retry } = useHubDeckSearch(
    "",
    undefined,
    true,
    availableEngines(),
    "community",
  );

  return (
    <CollapsibleDeckShelf
      title="Community decks"
      count={loading ? "Loading…" : decks.length}
      open={open}
      onOpenChange={onOpenChange}
    >
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
            <div key={entry.id} className={DECK_SHELF_CARD_CLASS}>
              <DeckHubEntryCard
                entry={entry}
                onOpen={() => onOpenDeck(entry.id)}
                onAuthorClick={onAuthorClick}
                onPlay={() => onPlayDeck(entry.id)}
                playing={pendingDeckId === entry.id}
                playDisabled={pendingDeckId !== null}
              />
            </div>
          ))}
        </DeckShelfRow>
      ) : (
        <p className="px-2 text-xs italic text-muted-foreground">
          {loading ? "Loading Community decks…" : "No Community decks are available."}
        </p>
      )}
    </CollapsibleDeckShelf>
  );
}
