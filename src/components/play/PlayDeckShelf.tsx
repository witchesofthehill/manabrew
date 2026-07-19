import { useNavigate } from "react-router-dom";
import { LibraryBig, Plus } from "lucide-react";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { useDeckStore } from "@/stores/useDeckStore";

const RECENT_DECK_COUNT = 4;

interface PlayDeckShelfProps {
  onQuickPlay: (savedDeckId: string) => void;
}

export function PlayDeckShelf({ onQuickPlay }: PlayDeckShelfProps) {
  const navigate = useNavigate();
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const recentDecks = savedDecks
    .filter(
      (savedDeck) =>
        !savedDeck.deck.draft &&
        savedDeck.deck.format !== "draft" &&
        savedDeck.deck.format !== "sealed",
    )
    .slice()
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, RECENT_DECK_COUNT);

  function openDeck(id: string) {
    navigate(`${ROUTES.PLAY_DECK}/${encodeURIComponent(id)}`);
  }

  function addDeck() {
    navigate(ROUTES.DECK_EDITOR, { state: { openNewDeckDialog: true } });
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/80 p-4 shadow-xl backdrop-blur-md sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Collection
          </p>
          <h2 className="font-serif text-2xl font-light tracking-tight sm:text-3xl">Your Decks</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={addDeck}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.DECK_EDITOR)}>
            View All
          </Button>
        </div>
      </div>

      {recentDecks.length > 0 ? (
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scroll-px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
          {recentDecks.map((deck) => (
            <div
              key={deck.id}
              className="w-[78vw] max-w-72 shrink-0 snap-start sm:w-auto sm:max-w-none"
            >
              <DeckGridCard
                deck={deck}
                onOpen={() => openDeck(deck.id)}
                onPlay={() => void onQuickPlay(deck.id)}
                readOnly
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-8 text-center">
          <LibraryBig className="mb-3 h-7 w-7 text-primary" />
          <p className="font-medium">Your first deck is waiting to be brewed.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Build from scratch or import a decklist you already play.
          </p>
          <Button size="sm" className="mt-4" onClick={addDeck}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
        </div>
      )}
    </section>
  );
}
