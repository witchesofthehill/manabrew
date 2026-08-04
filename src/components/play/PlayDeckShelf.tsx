import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LibraryBig, Plus } from "lucide-react";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import { useDeckTextImport } from "@/components/editor/useDeckTextImport";
import { PlayDeckTable, type PlayDeckRow } from "@/components/play/PlayDeckTable";
import { Button } from "@/components/ui/button";
import { DEFAULT_DECK_NAME, ROUTES } from "@/lib/constants";
import { GAME_FORMATS, getFormat } from "@/lib/formats";
import { cn } from "@/lib/utils";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { PresetDeck } from "@/lib/presetDecks";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { useMyDeckHubEntries } from "@/hooks/useMyDeckHubEntries";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { isFeatureEnabled } from "@/featureFlags";
import type { SavedDeck } from "@/stores/useDeckStore";

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
  const presetDecks = usePresetDecks();
  const [formatFilter, setFormatFilter] = useState("all");
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const importDeckText = useDeckTextImport();
  const {
    entries: publishedDecks,
    error: publishedDecksError,
    signedIn,
    refresh: refreshPublishedDecks,
  } = useMyDeckHubEntries();
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
  const filteredPublishedDecks =
    hubAccountsEnabled && signedIn
      ? publishedDecks.filter((deck) => matchesFormat(deck.format))
      : [];
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

  const rows: PlayDeckRow[] = [
    ...filteredDecks.map((deck): PlayDeckRow => {
      const presetKey = deck.accountDeckId
        ? accountDeckDetails[deck.accountDeckId]?.derivedFromPresetKey
        : undefined;
      return {
        key: deck.id,
        name: deck.deck.name,
        formatId: deck.deck.format ?? "standard",
        source: "yours",
        cover: resolveCoverCard(deck.deck),
        lastPlayed: deck.id === lastPlayedDeckId,
        badge: presetKey ? "Preset copy" : undefined,
        playing: pendingDeckId === deck.id,
        playDisabled: pendingDeckId !== null,
        onPlay: () => onPlay(materializeDeck(deck)),
        onOpen: () => openDeck(deck),
      };
    }),
    ...filteredPresets.map((preset): PlayDeckRow => {
      const presetId = preset.id ?? preset.name;
      return {
        key: `preset:${presetId}`,
        name: preset.name,
        formatId: preset.format ?? "standard",
        source: "starter",
        engines: preset.engines,
        cover: resolveCoverCard(preset),
        playing: pendingDeckId === presetId,
        playDisabled: pendingDeckId !== null,
        onPlay: () => onPlayPreset(preset),
        onOpen: () =>
          hubEnabled
            ? navigate(`${ROUTES.HUB}?deck=${encodeURIComponent(presetId)}&source=presets`)
            : onPlayPreset(preset),
      };
    }),
    ...filteredPublishedDecks.map(
      (entry): PlayDeckRow => ({
        key: `hub:${entry.id}`,
        name: entry.title,
        formatId: entry.format ?? "standard",
        source: "community",
        coverUrl: entry.coverImageUrl,
        badge: "Published",
        onOpen: () => setHubPreviewId(entry.id),
      }),
    ),
  ];

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
      {hubAccountsEnabled && signedIn && publishedDecksError && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1">{publishedDecksError}</span>
          <Button variant="outline" size="sm" onClick={() => void refreshPublishedDecks()}>
            Retry
          </Button>
        </div>
      )}

      {ownedDecks.length === 0 && (
        <div className="mb-4 flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/30 px-6 py-8 text-center">
          <LibraryBig className="mb-3 h-7 w-7 text-primary" />
          <p className="font-medium">Your first deck is waiting to be brewed.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Build from scratch, import a decklist — or start from a starter deck below.
          </p>
          <Button size="sm" className="mt-4" onClick={addDeck}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
        </div>
      )}

      {rows.length > 0 ? (
        <PlayDeckTable rows={rows} />
      ) : (
        <p className="py-4 text-center text-xs italic text-muted-foreground">
          {presetDecks.length === 0
            ? "Loading decks…"
            : `No ${formatName ?? ""} decks yet — build one or pick another format.`}
        </p>
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
      {hubEnabled && (
        <HubDeckPreviewDialog deckId={hubPreviewId} onClose={() => setHubPreviewId(null)} />
      )}
    </section>
  );
}
