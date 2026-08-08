import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import { useDeckTextImport } from "@/components/editor/useDeckTextImport";
import { CommunityDeckShelf } from "@/components/play/CommunityDeckShelf";
import { OwnedDeckShelf } from "@/components/play/OwnedDeckShelf";
import { PresetDeckShelf } from "@/components/play/PresetDeckShelf";
import { Button } from "@/components/ui/button";
import { isFeatureEnabled } from "@/featureFlags";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { DEFAULT_DECK_NAME, ROUTES } from "@/lib/constants";
import { availableEngines } from "@/lib/engines";
import { presetSupportsEngine, type PresetDeck } from "@/lib/presetDecks";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
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
  usePreferencesStore((state) => state.ironsmithRuntimeEnabled);
  const presetDecks = usePresetDecks();
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [communityOpen, setCommunityOpen] = useState(true);
  const [presetsOpenOverride, setPresetsOpenOverride] = useState<boolean | null>(null);
  const importDeckText = useDeckTextImport();
  const hubEnabled = isFeatureEnabled("deckHub");
  const {
    details: accountDeckDetails,
    error: accountDecksError,
    available: accountDecksAvailable,
    signedIn: accountDecksSignedIn,
    resolved: accountDecksResolved,
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
  ].sort(
    (a, b) => (lastPlayedAtByDeck[b.id] ?? b.savedAt) - (lastPlayedAtByDeck[a.id] ?? a.savedAt),
  );
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
  const presetKeyByDeckId = Object.fromEntries(
    ownedDecks.map((deck) => [
      deck.id,
      hubEnabled && deck.accountDeckId
        ? accountDeckDetails[deck.accountDeckId]?.derivedFromPresetKey
        : undefined,
    ]),
  );
  const presetsOpen = presetsOpenOverride ?? (accountDecksResolved && ownedDecks.length === 0);

  function materializeDeck(saved: SavedDeck) {
    return saved.accountDeckId
      ? loadAccountDeck(saved.accountDeckId, saved.accountVersionNo ?? 1, saved.deck)
      : saved.id;
  }

  function openDeck(saved: SavedDeck) {
    const id = materializeDeck(saved);
    navigate(
      { pathname: ROUTES.DECK_EDITOR, search: `?deck=${encodeURIComponent(id)}` },
      { state: { deckEditorFromList: true } },
    );
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
      { pathname: ROUTES.DECK_EDITOR, search: `?deck=${encodeURIComponent(id)}` },
      { state: { deckEditorFromList: true } },
    );
  }

  function openPreset(preset: PresetDeck) {
    const presetId = preset.id ?? preset.name;
    if (hubEnabled) {
      navigate(`${ROUTES.HUB}?deck=${encodeURIComponent(presetId)}&source=presets`);
    } else if (pendingDeckId === null) {
      onPlayPreset(preset);
    }
  }

  function openCommunityDeck(id: string) {
    navigate(`${ROUTES.HUB}?deck=${encodeURIComponent(id)}&source=community`);
  }

  function openCommunityAuthor(author: string) {
    navigate(`${ROUTES.HUB}?q=${encodeURIComponent(author)}&source=community`);
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-background/80 p-5 shadow-xl backdrop-blur-md sm:p-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-serif text-2xl font-light tracking-tight sm:text-3xl">My Decks</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setChoiceOpen(true)}>
            <Plus className="h-4 w-4" />
            Build / Import
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.DECK_EDITOR)}>
            View All
          </Button>
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

      <div className="space-y-5">
        <OwnedDeckShelf
          decks={ownedDecks}
          lastPlayedDeckId={lastPlayedDeckId}
          presetKeyByDeckId={presetKeyByDeckId}
          pendingDeckId={pendingDeckId}
          onAddDeck={() => setChoiceOpen(true)}
          onOpenDeck={openDeck}
          onPlayDeck={(deck) => onPlay(materializeDeck(deck))}
          onViewPreset={(presetKey) =>
            navigate(`${ROUTES.HUB}?deck=${encodeURIComponent(presetKey)}&source=presets`)
          }
        />
        {hubEnabled && (
          <CommunityDeckShelf
            open={communityOpen}
            onOpenChange={setCommunityOpen}
            onOpenDeck={openCommunityDeck}
            onAuthorClick={openCommunityAuthor}
          />
        )}
        <PresetDeckShelf
          decks={visiblePresets}
          loaded={presetDecks.length > 0}
          open={presetsOpen}
          pendingDeckId={pendingDeckId}
          onOpenChange={setPresetsOpenOverride}
          onOpenDeck={openPreset}
          onPlayDeck={onPlayPreset}
        />
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
    </section>
  );
}
