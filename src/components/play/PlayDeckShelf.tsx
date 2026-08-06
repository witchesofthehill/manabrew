import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LibraryBig, Plus } from "lucide-react";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { DeckShelfRow } from "@/components/play/DeckShelfRow";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import { useDeckTextImport } from "@/components/editor/useDeckTextImport";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled } from "@/featureFlags";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useHubDeckSearch } from "@/hooks/useHubDeckSearch";
import { DEFAULT_DECK_NAME, ROUTES } from "@/lib/constants";
import { GAME_FORMATS, getFormat } from "@/lib/formats";
import { presetSupportsEngine, type PresetDeck } from "@/lib/presetDecks";
import { availableEngines, hubEntryEngines, supportsAvailableEngine } from "@/lib/engines";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { SavedDeck } from "@/stores/useDeckStore";

type DeckSource = "all" | "yours" | "preset" | "community";

const SHELF_CARD_CLASS = "w-[70vw] max-w-64 shrink-0 snap-start sm:w-72 sm:max-w-none";

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {title}
      </h3>
      {count !== undefined && <span className="text-[11px] text-muted-foreground">{count}</span>}
    </div>
  );
}

interface PlayDeckShelfProps {
  onPlay: (savedDeckId: string) => void;
  onPlayPreset: (preset: PresetDeck) => void;
  pendingDeckId: string | null;
}

export function PlayDeckShelf({ onPlay, onPlayPreset, pendingDeckId }: PlayDeckShelfProps) {
  const navigate = useNavigate();
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const loadAccountDeck = useDeckStore((state) => state.loadAccountDeck);
  const lastPlayedDeckId = usePreferencesStore((state) => state.lastPlayedDeckId);
  const lastPlayedAtByDeck = usePreferencesStore((state) => state.lastPlayedAtByDeck);
  // Subscribed so engine availability re-renders when the Settings toggle flips.
  usePreferencesStore((state) => state.ironsmithRuntimeEnabled);
  const presetDecks = usePresetDecks();
  const [formatFilter, setFormatFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<DeckSource>("all");
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importDeckText = useDeckTextImport();
  const [hubPreviewId, setHubPreviewId] = useState<string | null>(null);
  const hubEnabled = isFeatureEnabled("deckHub");
  const communityDecks = useHubDeckSearch(
    "",
    formatFilter === "all" ? undefined : formatFilter,
    hubEnabled && (sourceFilter === "all" || sourceFilter === "community"),
    availableEngines(),
    "community",
  );
  const communityEntries = communityDecks.decks.filter((entry) =>
    supportsAvailableEngine(hubEntryEngines(entry)),
  );
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
  const forkedPresetKeys = new Set(
    Object.values(accountDeckDetails)
      .map((detail) => detail.derivedFromPresetKey?.toLowerCase())
      .filter((key): key is string => key !== undefined),
  );
  const visiblePresets = presetDecks.filter(
    (preset) =>
      !forkedPresetKeys.has((preset.id ?? "").toLowerCase()) &&
      availableEngines().some((engine) => presetSupportsEngine(preset, engine)),
  );

  const matchesFormat = (format?: string) =>
    formatFilter === "all" || (format ?? "standard") === formatFilter;
  const showSection = (source: DeckSource) => sourceFilter === "all" || sourceFilter === source;
  const filteredDecks = ownedDecks
    .filter((savedDeck) => matchesFormat(savedDeck.deck.format))
    .slice()
    .sort(
      (a, b) => (lastPlayedAtByDeck[b.id] ?? b.savedAt) - (lastPlayedAtByDeck[a.id] ?? a.savedAt),
    );
  const filteredPresets = visiblePresets.filter((preset) => matchesFormat(preset.format));
  const formatName =
    formatFilter === "all" ? null : (getFormat(formatFilter)?.name ?? formatFilter);

  const sourceFilters: Array<{ id: DeckSource; name: string }> = [
    { id: "all", name: "All decks" },
    { id: "yours", name: "Your decks" },
    { id: "preset", name: "Preset decks" },
    ...(hubEnabled ? [{ id: "community" as const, name: "Community decks" }] : []),
  ];

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

  const filterChipClass = (active: boolean) =>
    cn(
      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors motion-reduce:transition-none pointer-coarse:min-h-10 pointer-coarse:px-3",
      active
        ? "border-primary/50 bg-primary/15 text-primary"
        : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground",
    );

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/80 p-5 shadow-xl backdrop-blur-md sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-serif text-2xl font-light tracking-tight sm:text-3xl">My Decks</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={addDeck}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.DECK_EDITOR)}>
            View All
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Show
          </span>
          <div
            role="group"
            aria-label="Filter decks by source"
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar"
          >
            {sourceFilters.map((source) => (
              <button
                key={source.id}
                type="button"
                aria-pressed={sourceFilter === source.id}
                onClick={() => setSourceFilter(source.id)}
                className={filterChipClass(sourceFilter === source.id)}
              >
                {source.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Format
          </span>
          <div
            role="group"
            aria-label="Filter decks by format"
            className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 no-scrollbar"
          >
            {[{ id: "all", name: "All formats" }, ...GAME_FORMATS].map((format) => (
              <button
                key={format.id}
                type="button"
                aria-pressed={formatFilter === format.id}
                onClick={() => setFormatFilter(format.id)}
                className={filterChipClass(formatFilter === format.id)}
              >
                {format.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {accountDecksAvailable && accountDecksSignedIn && accountDecksError && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{accountDecksError}</span>
          <Button variant="outline" size="sm" onClick={() => void refreshAccountDecks()}>
            Retry
          </Button>
        </div>
      )}

      <div className="space-y-6">
        {showSection("yours") && (
          <div>
            <SectionHeader title="Your decks" count={filteredDecks.length} />
            {filteredDecks.length > 0 ? (
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
            ) : ownedDecks.length === 0 ? (
              <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-8 text-center">
                <LibraryBig className="mb-3 h-7 w-7 text-primary" />
                <p className="font-medium">Your first deck is waiting to be brewed.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Build from scratch, import a decklist — or start from a preset deck below.
                </p>
                <Button size="sm" className="mt-4" onClick={addDeck}>
                  <Plus className="h-4 w-4" />
                  Build / Import
                </Button>
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No {formatName} decks of yours yet.
              </p>
            )}
          </div>
        )}

        {showSection("preset") && (
          <div>
            <SectionHeader title="Preset decks" count={filteredPresets.length} />
            {filteredPresets.length > 0 ? (
              <DeckShelfRow label="Preset decks">
                {filteredPresets.map((preset) => {
                  const presetId = preset.id ?? preset.name;
                  return (
                    <div key={`preset:${presetId}`} className={SHELF_CARD_CLASS}>
                      <DeckGridCard
                        deck={{ id: presetId, deck: preset, savedAt: 0 }}
                        onOpen={() => {
                          if (hubEnabled) {
                            navigate(
                              `${ROUTES.HUB}?deck=${encodeURIComponent(presetId)}&source=presets`,
                            );
                          } else if (pendingDeckId === null) {
                            onPlayPreset(preset);
                          }
                        }}
                        onPlay={() => onPlayPreset(preset)}
                        badge="Official preset"
                        engines={preset.engines}
                        playing={pendingDeckId === presetId}
                        playDisabled={pendingDeckId !== null}
                        readOnly
                      />
                    </div>
                  );
                })}
              </DeckShelfRow>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                {presetDecks.length === 0
                  ? "Loading preset decks…"
                  : `No preset decks for ${formatName ?? "this format"}.`}
              </p>
            )}
          </div>
        )}

        {hubEnabled && showSection("community") && (
          <div>
            <SectionHeader
              title="Community decks"
              count={communityDecks.loading ? undefined : communityEntries.length}
            />
            {communityDecks.error ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                <span className="min-w-0 break-words">{communityDecks.error}</span>
                <Button variant="outline" size="sm" onClick={communityDecks.retry}>
                  Retry
                </Button>
              </div>
            ) : communityDecks.loading && communityEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground">Loading community decks…</p>
            ) : communityEntries.length > 0 ? (
              <DeckShelfRow label="Community decks">
                {communityEntries.map((entry) => (
                  <div key={`hub:${entry.id}`} className={SHELF_CARD_CLASS}>
                    <DeckHubEntryCard entry={entry} onOpen={() => setHubPreviewId(entry.id)} />
                  </div>
                ))}
              </DeckShelfRow>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                No community decks for {formatName ?? "this format"} yet.
              </p>
            )}
          </div>
        )}
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
