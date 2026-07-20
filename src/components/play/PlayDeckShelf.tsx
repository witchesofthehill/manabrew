import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LibraryBig, Plus } from "lucide-react";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { DeckShelfRow } from "@/components/play/DeckShelfRow";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { GAME_FORMATS, getFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";

const SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

interface PlayDeckShelfProps {
  onQuickPlay: (savedDeckId: string) => void;
  onQuickPlayPreset: (preset: Deck) => void;
  pendingDeckId: string | null;
}

export function PlayDeckShelf({
  onQuickPlay,
  onQuickPlayPreset,
  pendingDeckId,
}: PlayDeckShelfProps) {
  const navigate = useNavigate();
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const lastPlayedDeckId = usePreferencesStore((state) => state.lastPlayedDeckId);
  const lastPlayedAtByDeck = usePreferencesStore((state) => state.lastPlayedAtByDeck);
  const presetDecks = usePresetDecks();
  const [formatFilter, setFormatFilter] = useState("commander");
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(null);

  const ownedDecks = savedDecks.filter((savedDeck) => !savedDeck.deck.draft);
  const matchesFormat = (format?: string) =>
    formatFilter === "all" || (format ?? "standard") === formatFilter;
  const filteredDecks = ownedDecks
    .filter((savedDeck) => matchesFormat(savedDeck.deck.format))
    .slice()
    .sort(
      (a, b) => (lastPlayedAtByDeck[b.id] ?? b.savedAt) - (lastPlayedAtByDeck[a.id] ?? a.savedAt),
    );
  const filteredPresets = presetDecks.filter((preset) => matchesFormat(preset.format));
  const collapsed = collapsedOverride ?? ownedDecks.length > 0;
  const formatName =
    formatFilter === "all" ? null : (getFormat(formatFilter)?.name ?? formatFilter);

  function openDeck(id: string) {
    navigate(`${ROUTES.PLAY_DECK}/${encodeURIComponent(id)}`);
  }

  function addDeck() {
    navigate(ROUTES.DECK_EDITOR, { state: { openNewDeckDialog: true } });
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/80 p-5 shadow-xl backdrop-blur-md sm:p-6">
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
                  onPlay={() => onQuickPlay(deck.id)}
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
            Build from scratch, import a decklist — or grab a starter deck below.
          </p>
          <Button size="sm" className="mt-4" onClick={addDeck}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
        </div>
      )}

      <div className="mt-5 border-t border-border/50 pt-4">
        <button
          type="button"
          onClick={() => setCollapsedOverride(!collapsed)}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2 text-left"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform motion-reduce:transition-none",
              collapsed && "-rotate-90",
            )}
          />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Starter Decks
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {filteredPresets.length}
          </span>
        </button>

        {!collapsed &&
          (filteredPresets.length > 0 ? (
            <div className="mt-4">
              <DeckShelfRow label="Starter decks">
                {filteredPresets.map((preset) => {
                  const presetId = preset.id ?? preset.name;
                  return (
                    <div key={presetId} className={SHELF_CARD_CLASS}>
                      <DeckGridCard
                        deck={{ id: presetId, deck: preset, savedAt: 0 }}
                        onOpen={() => {
                          if (pendingDeckId === null) onQuickPlayPreset(preset);
                        }}
                        onPlay={() => onQuickPlayPreset(preset)}
                        playing={pendingDeckId === presetId}
                        playDisabled={pendingDeckId !== null}
                        readOnly
                      />
                    </div>
                  );
                })}
              </DeckShelfRow>
            </div>
          ) : (
            <p className="mt-3 text-xs italic text-muted-foreground">
              {presetDecks.length > 0
                ? `No starter decks for ${formatName ?? "this format"}.`
                : "Loading starter decks…"}
            </p>
          ))}
      </div>
    </section>
  );
}
