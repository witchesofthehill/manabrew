import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardPaste, Globe, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useHubStore } from "@/stores/useHubStore";
import { useHubDeckPlaytest, useQuickPlaytest } from "@/hooks/useQuickPlaytest";
import { presetDeckParamId } from "@/views/myDecks.utils";
import type { SavedDeck } from "@/stores/useDeckStore";

const DECK_GRID_CLASS =
  "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3";
const PRESET_PREVIEW_COUNT = 12;
const HUB_PREVIEW_COUNT = 6;

function SectionHeader({ title, to, linkLabel }: { title: string; to: string; linkLabel: string }) {
  return (
    <div className="flex items-baseline justify-between pb-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <Link
        to={to}
        className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
      >
        {linkLabel}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const quickPlaytest = useQuickPlaytest();
  const hubPlaytest = useHubDeckPlaytest();
  const savedDecks = useDeckStore((s) => s.savedDecks);
  const clearDeck = useDeckStore((s) => s.clearDeck);
  const presetDecks = usePresetDecks();
  const hubList = useHubStore((s) => s.list);
  const hubError = useHubStore((s) => s.listError);
  const fetchDecks = useHubStore((s) => s.fetchDecks);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showAllPresets, setShowAllPresets] = useState(false);

  useEffect(() => {
    void fetchDecks({ sort: "newest", page: 1, pageSize: HUB_PREVIEW_COUNT });
  }, [fetchDecks]);

  const myDecks = [...savedDecks].sort((a, b) => b.savedAt - a.savedAt);
  const presetEntries: SavedDeck[] = presetDecks.map((deck) => ({
    id: presetDeckParamId(deck),
    deck,
    savedAt: 0,
  }));
  const visiblePresets = showAllPresets
    ? presetEntries
    : presetEntries.slice(0, PRESET_PREVIEW_COUNT);

  function handleNewDeck() {
    clearDeck();
    navigate("/deck-editor", { state: { directToEditor: true } });
  }

  function handleImportDeck() {
    navigate("/deck-editor", { state: { openImport: true } });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-8">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-lg font-semibold flex-1">Home</h2>
          <Button size="sm" variant="outline" onClick={handleImportDeck}>
            <ClipboardPaste className="mr-1 h-4 w-4" />
            Import deck
          </Button>
          <Button size="sm" variant="outline" onClick={handleNewDeck}>
            <Plus className="mr-1 h-4 w-4" />
            New deck
          </Button>
          <Button size="sm" asChild>
            <Link to="/lobby">
              <Globe className="mr-1 h-4 w-4" />
              Play online
            </Link>
          </Button>
        </div>

        <section>
          <SectionHeader title="Your decks" to="/deck-editor" linkLabel="My Decks" />
          {myDecks.length === 0 ? (
            <div className="rounded-lg border border-dashed px-6 py-10 text-center space-y-3">
              <p className="text-lg font-semibold">No decks yet</p>
              <p className="text-sm text-muted-foreground">
                Paste a decklist from Moxfield or anywhere, pick a starter deck below, or build your
                own brew.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button size="sm" onClick={handleImportDeck}>
                  <ClipboardPaste className="mr-1 h-4 w-4" />
                  Import a deck
                </Button>
                <Button size="sm" variant="outline" onClick={handleNewDeck}>
                  <Plus className="mr-1 h-4 w-4" />
                  Build from scratch
                </Button>
              </div>
            </div>
          ) : (
            <div className={DECK_GRID_CLASS}>
              {myDecks.map((saved) => (
                <DeckGridCard
                  key={saved.id}
                  deck={saved}
                  onOpen={() => navigate(`/deck-editor?deck=${encodeURIComponent(saved.id)}`)}
                  onPlaytest={() => quickPlaytest(saved.deck)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionHeader title="Starter decks" to="/play" linkLabel="Play" />
          <div className={DECK_GRID_CLASS}>
            {visiblePresets.map((preset) => (
              <DeckGridCard
                key={preset.id}
                deck={preset}
                readOnly
                onOpen={() => navigate(`/deck-editor?deck=${encodeURIComponent(preset.id)}`)}
                onPlaytest={() => quickPlaytest(preset.deck)}
              />
            ))}
          </div>
          {presetEntries.length > PRESET_PREVIEW_COUNT && (
            <div className="pt-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => setShowAllPresets((v) => !v)}>
                {showAllPresets ? "Show fewer" : `Show all ${presetEntries.length}`}
              </Button>
            </div>
          )}
        </section>

        <section>
          <SectionHeader title="Fresh from the Deck Hub" to="/hub" linkLabel="Deck Hub" />
          {hubError ? (
            <p className="text-sm text-muted-foreground">The Deck Hub is unreachable right now.</p>
          ) : hubList === null ? (
            <p className="text-sm text-muted-foreground">Loading decks…</p>
          ) : hubList.decks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing published yet — share one of yours from My Decks.
            </p>
          ) : (
            <div className={DECK_GRID_CLASS}>
              {hubList.decks.slice(0, HUB_PREVIEW_COUNT).map((deck) => (
                <HubDeckCard
                  key={deck.id}
                  deck={deck}
                  onOpen={() => setPreviewId(deck.id)}
                  onPlaytest={() => hubPlaytest(deck.id)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <HubDeckPreviewDialog deckId={previewId} onClose={() => setPreviewId(null)} />
    </div>
  );
}
