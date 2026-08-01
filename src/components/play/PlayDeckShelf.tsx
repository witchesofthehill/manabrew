import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LibraryBig, Plus } from "lucide-react";
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
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { useMyHubDecks } from "@/hooks/useMyHubDecks";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { isFeatureEnabled } from "@/featureFlags";
import type { SavedDeck } from "@/stores/useDeckStore";

const SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

interface PlayDeckShelfProps {
  onPlay: (savedDeckId: string) => void;
  onPlayPreset: (preset: Deck) => void;
  pendingDeckId: string | null;
}

export function PlayDeckShelf({ onPlay, onPlayPreset, pendingDeckId }: PlayDeckShelfProps) {
  const navigate = useNavigate();
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const loadAccountDeck = useDeckStore((state) => state.loadAccountDeck);
  const lastPlayedDeckId = usePreferencesStore((state) => state.lastPlayedDeckId);
  const lastPlayedAtByDeck = usePreferencesStore((state) => state.lastPlayedAtByDeck);
  const presetDecks = usePresetDecks();
  const [formatFilter, setFormatFilter] = useState("all");
  const [presetsCollapsedOverride, setPresetsCollapsedOverride] = useState<boolean | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importDeckText = useDeckTextImport();
  const {
    decks: publishedDecks,
    loading: publishedDecksLoading,
    error: publishedDecksError,
    signedIn,
    refresh: refreshPublishedDecks,
  } = useMyHubDecks();
  const [hubPreviewId, setHubPreviewId] = useState<string | null>(null);
  const hubEnabled = isFeatureEnabled("deckHub");
  const accountsEnabled = isFeatureEnabled("accounts");
  const hubAccountsEnabled = hubEnabled && accountsEnabled;
  const {
    details: accountDeckDetails,
    error: accountDecksError,
    available: accountDecksAvailable,
    signedIn: accountDecksSignedIn,
    refresh: refreshAccountDecks,
  } = useAccountDecks();

  const accountSavedDecks: SavedDeck[] = Object.values(accountDeckDetails).map((detail) => ({
    id: `account:${detail.id}`,
    deck: detail.deck as SavedDeck["deck"],
    savedAt: new Date(detail.updatedAt).getTime(),
    accountDeckId: detail.id,
    accountVersionNo: detail.currentVersionNo,
  }));
  const ownedDecks = [
    ...savedDecks.filter(
      (savedDeck) =>
        !savedDeck.deck.draft &&
        (!savedDeck.accountDeckId || accountDeckDetails[savedDeck.accountDeckId] === undefined),
    ),
    ...accountSavedDecks.filter((savedDeck) => !savedDeck.deck.draft),
  ];
  const matchesFormat = (format?: string) =>
    formatFilter === "all" || (format ?? "standard") === formatFilter;
  const filteredDecks = ownedDecks
    .filter((savedDeck) => matchesFormat(savedDeck.deck.format))
    .slice()
    .sort(
      (a, b) => (lastPlayedAtByDeck[b.id] ?? b.savedAt) - (lastPlayedAtByDeck[a.id] ?? a.savedAt),
    );
  const filteredPresets = presetDecks.filter((preset) => matchesFormat(preset.format));
  const filteredPublishedDecks = publishedDecks.filter((deck) => matchesFormat(deck.format));
  const presetsCollapsed = presetsCollapsedOverride ?? ownedDecks.length > 0;
  const formatName =
    formatFilter === "all" ? null : (getFormat(formatFilter)?.name ?? formatFilter);

  function materializeDeck(saved: SavedDeck) {
    return saved.accountDeckId
      ? loadAccountDeck(saved.accountDeckId, saved.accountVersionNo ?? 1, saved.deck)
      : saved.id;
  }

  function openDeck(saved: SavedDeck) {
    const id = materializeDeck(saved);
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
          {hubEnabled && (
            <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.HUB)}>
              <LibraryBig className="h-4 w-4" />
              Deck Hub
            </Button>
          )}
          <Button size="sm" onClick={addDeck}>
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
              "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none pointer-coarse:min-h-10 pointer-coarse:px-3",
              formatFilter === format.id
                ? "border-primary/50 bg-primary/15 text-primary"
                : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {format.name}
          </button>
        ))}
      </div>

      {accountDecksAvailable && accountDecksSignedIn && accountDecksError && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{accountDecksError}</span>
          <Button variant="outline" size="sm" onClick={() => void refreshAccountDecks()}>
            Retry
          </Button>
        </div>
      )}

      {ownedDecks.length > 0 ? (
        filteredDecks.length > 0 ? (
          <DeckShelfRow label="Your decks">
            {filteredDecks.map((deck) => {
              const presetKey = deck.accountDeckId
                ? accountDeckDetails[deck.accountDeckId]?.derivedFromPresetKey
                : undefined;
              return (
                <div key={deck.id} className={cn(SHELF_CARD_CLASS, "relative")}>
                  {deck.id === lastPlayedDeckId && (
                    <span className="absolute right-1.5 top-1.5 z-20 rounded bg-background/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary shadow-sm backdrop-blur-sm">
                      Last played
                    </span>
                  )}
                  <DeckGridCard
                    deck={deck}
                    onOpen={() => openDeck(deck)}
                    onPlay={() => onPlay(materializeDeck(deck))}
                    onViewInHub={
                      hubEnabled && presetKey
                        ? () =>
                            navigate(
                              `${ROUTES.HUB}?deck=${encodeURIComponent(presetKey)}&source=presets`,
                            )
                        : undefined
                    }
                    badge={presetKey ? "Preset copy" : undefined}
                    playing={pendingDeckId === deck.id}
                    playDisabled={pendingDeckId !== null}
                    readOnly
                  />
                </div>
              );
            })}
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

      {hubAccountsEnabled && signedIn && (
        <div className="mt-5 border-t border-border/50 pt-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Published on Deck Hub
            </span>
            {!publishedDecksLoading && (
              <span className="text-[11px] text-muted-foreground">
                {filteredPublishedDecks.length}
              </span>
            )}
          </div>
          {publishedDecksError ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span className="min-w-0 break-words">{publishedDecksError}</span>
              <Button variant="outline" size="sm" onClick={() => void refreshPublishedDecks()}>
                Retry
              </Button>
            </div>
          ) : publishedDecksLoading && publishedDecks.length === 0 ? (
            <p className="text-xs text-muted-foreground">Loading published decks…</p>
          ) : publishedDecks.length === 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>You haven’t published a deck yet.</span>
              <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.DECK_EDITOR)}>
                Open My Decks
              </Button>
            </div>
          ) : filteredPublishedDecks.length > 0 ? (
            <DeckShelfRow label="Published Deck Hub decks">
              {filteredPublishedDecks.map((deck) => (
                <div key={deck.id} className={SHELF_CARD_CLASS}>
                  <HubDeckCard deck={deck} onOpen={() => setHubPreviewId(deck.id)} />
                </div>
              ))}
            </DeckShelfRow>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              No published decks for {formatName ?? "this format"}.
            </p>
          )}
        </div>
      )}

      <div className="mt-5 border-t border-border/50 pt-4">
        <button
          type="button"
          onClick={() => setPresetsCollapsedOverride(!presetsCollapsed)}
          aria-expanded={!presetsCollapsed}
          className="flex w-full items-center gap-2 text-left pointer-coarse:min-h-10"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform motion-reduce:transition-none",
              presetsCollapsed && "-rotate-90",
            )}
          />
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Starter Decks
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {filteredPresets.length}
          </span>
        </button>

        {!presetsCollapsed &&
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
                          if (pendingDeckId === null) onPlayPreset(preset);
                        }}
                        onPlay={() => onPlayPreset(preset)}
                        onViewInHub={
                          hubEnabled
                            ? () =>
                                navigate(
                                  `${ROUTES.HUB}?deck=${encodeURIComponent(presetId)}&source=presets`,
                                )
                            : undefined
                        }
                        badge="Official preset"
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
      {hubEnabled && (
        <HubDeckPreviewDialog deckId={hubPreviewId} onClose={() => setHubPreviewId(null)} />
      )}
    </section>
  );
}
