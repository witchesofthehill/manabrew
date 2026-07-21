import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LibraryBig, Plus } from "lucide-react";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import { useDeckTextImport } from "@/components/editor/useDeckTextImport";
import { DeckShelfRow } from "@/components/play/DeckShelfRow";
import { Button } from "@/components/ui/button";
import { DEFAULT_DECK_NAME, ROUTES } from "@/lib/constants";
import { GAME_FORMATS, getFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

const SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

interface PlayDeckShelfProps {
  onPlay: (savedDeckId: string) => void;
  pendingDeckId: string | null;
}

export function PlayDeckShelf({ onPlay, pendingDeckId }: PlayDeckShelfProps) {
  const navigate = useNavigate();
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const lastPlayedDeckId = usePreferencesStore((state) => state.lastPlayedDeckId);
  const lastPlayedAtByDeck = usePreferencesStore((state) => state.lastPlayedAtByDeck);
  const [formatFilter, setFormatFilter] = useState("all");
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importDeckText = useDeckTextImport();

  const ownedDecks = savedDecks.filter((savedDeck) => !savedDeck.deck.draft);
  const matchesFormat = (format?: string) =>
    formatFilter === "all" || (format ?? "standard") === formatFilter;
  const filteredDecks = ownedDecks
    .filter((savedDeck) => matchesFormat(savedDeck.deck.format))
    .slice()
    .sort(
      (a, b) => (lastPlayedAtByDeck[b.id] ?? b.savedAt) - (lastPlayedAtByDeck[a.id] ?? a.savedAt),
    );
  const formatName =
    formatFilter === "all" ? null : (getFormat(formatFilter)?.name ?? formatFilter);

  function openDeck(id: string) {
    navigate(
      {
        pathname: ROUTES.DECK_EDITOR,
        search: `?deck=${encodeURIComponent(id)}`,
      },
      { state: { deckEditorFromList: true } },
    );
  }

  function addDeck() {
    setChoiceOpen(true);
  }

  function buildFromScratch() {
    setChoiceOpen(false);
    const store = useDeckStore.getState();
    store.clearDeck();
    store.setDeckName(DEFAULT_DECK_NAME);
    navigate(ROUTES.DECK_EDITOR, { state: { directToEditor: true } });
  }

  async function importDeck(
    ...args: Parameters<ReturnType<typeof useDeckTextImport>>
  ): Promise<void> {
    const id = await importDeckText(...args);
    navigate(
      {
        pathname: ROUTES.DECK_EDITOR,
        search: `?deck=${encodeURIComponent(id)}`,
      },
      { state: { deckEditorFromList: true } },
    );
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/80 p-5 shadow-xl backdrop-blur-md sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-serif text-2xl font-light tracking-tight sm:text-3xl">My Decks</h2>
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

      <div
        role="group"
        aria-label="Filter decks by format"
        className="-mx-1 mb-4 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar"
      >
        {[{ id: "all", name: "All" }, ...GAME_FORMATS].map((format) => (
          <button
            key={format.id}
            type="button"
            aria-pressed={formatFilter === format.id}
            onClick={() => setFormatFilter(format.id)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none",
              formatFilter === format.id
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {format.name}
          </button>
        ))}
      </div>

      {ownedDecks.length > 0 ? (
        filteredDecks.length > 0 ? (
          <DeckShelfRow label="Your decks">
            {filteredDecks.map((deck) => (
              <div key={deck.id} className={cn(SHELF_CARD_CLASS, "relative")}>
                {deck.id === lastPlayedDeckId && (
                  <span className="absolute right-1.5 top-1.5 z-20 rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary shadow-sm backdrop-blur-sm">
                    Last played
                  </span>
                )}
                <DeckGridCard
                  deck={deck}
                  onOpen={() => openDeck(deck.id)}
                  onPlay={() => onPlay(deck.id)}
                  playing={pendingDeckId === deck.id}
                  playDisabled={pendingDeckId !== null}
                  readOnly
                />
              </div>
            ))}
          </DeckShelfRow>
        ) : (
          <p className="py-4 text-center text-xs italic text-muted-foreground">
            No {formatName} decks yet — build one or pick another format.
          </p>
        )
      ) : (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-8 text-center">
          <LibraryBig className="mb-3 h-7 w-7 text-primary" />
          <p className="font-medium">Your first deck is waiting to be brewed.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Build from scratch or import a decklist to start your collection.
          </p>
          <Button size="sm" className="mt-4" onClick={addDeck}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
        </div>
      )}

      <NewDeckChoiceDialog
        open={choiceOpen}
        onOpenChange={setChoiceOpen}
        onImport={() => {
          setChoiceOpen(false);
          setImportOpen(true);
        }}
        onFromScratch={buildFromScratch}
      />
      <ImportDeckTextDialog open={importOpen} onOpenChange={setImportOpen} onImport={importDeck} />
    </section>
  );
}
