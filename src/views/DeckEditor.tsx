import { DeckBuilder } from "@/components/editor/DeckBuilder";
import {
  useDeckUnsavedChanges,
  revertDeckToLastSaved,
} from "@/components/editor/deckBuilder.unsavedChanges";
import { CardSearch } from "@/components/editor/CardSearch";
import { useTopBarOverride } from "@/components/layout/TopBarOverride";
import { useKeybindings } from "@/hooks/useKeybindings";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useDeckStore } from "@/stores/useDeckStore";
import { isFeatureEnabled } from "@/featureFlags";
import { DROP_ZONE, DEFAULT_DECK_NAME, ROUTES } from "@/lib/constants";
import { useEffect, useRef, useState } from "react";
import type { DeckCard, DeckFormat } from "@/protocol/deck";
import type { Deck as DeckType } from "@/protocol/deck";
import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { useBlocker, useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { DeckListControls } from "@/components/deck/DeckListControls";
import { PublishDeckDialog } from "@/components/deck/PublishDeckDialog";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import type { ParsedDeckEntry } from "@/lib/deckImport";
import { useDeckTextImport } from "@/components/editor/useDeckTextImport";
import { applyDeckFilters, presetDeckParamId, PRESET_DECK_ID_PREFIX } from "@/views/myDecks.utils";
import type { SortBy } from "@/views/myDecks.utils";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useQuickPlaytest } from "@/hooks/useQuickPlaytest";
import { useMyHubDecks } from "@/hooks/useMyHubDecks";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useNavigate } from "react-router";
import type { SavedDeck } from "@/stores/useDeckStore";
import { HubDeckCard } from "@/components/deck/HubDeckCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";

export default function DeckEditor() {
  const {
    addToMain,
    addToSide,
    addToMaybe,
    removeFromMain,
    removeFromSide,
    removeFromMaybe,
    currentDeck,
    tagCard,
    untagCard,
    savedDecks,
    loadSavedDeck,
    clearDeck,
    setDeckName,
    deleteSavedDeck,
    currentDeckId: _currentDeckId,
    loadAccountDeck,
    linkSavedDeckToAccount,
  } = useDeckStore();
  const importDeckText = useDeckTextImport();
  const isReadOnly = useDeckStore((s) => s.isReadOnly);
  const loadPresetDeck = useDeckStore((s) => s.loadPresetDeck);
  const presetDecks = usePresetDecks();
  const { quickPlaytest, playtestDialog } = useQuickPlaytest();
  const {
    decks: publishedDecks,
    loading: publishedDecksLoading,
    error: publishedDecksError,
    signedIn,
    refresh: refreshPublishedDecks,
  } = useMyHubDecks();
  const {
    details: accountDeckDetails,
    loading: accountDecksLoading,
    error: accountDecksError,
    available: accountDecksAvailable,
    signedIn: accountDecksSignedIn,
    refresh: refreshAccountDecks,
  } = useAccountDecks();
  const navigate = useNavigate();
  const hubEnabled = isFeatureEnabled("deckHub");
  const publishEnabled = hubEnabled && isFeatureEnabled("accounts");
  const location = useLocation();
  const routeState = location.state as {
    directToEditor?: boolean;
    deckEditorFromList?: boolean;
    resumePublishDeckId?: string;
    resumePublishDeck?: SavedDeck["deck"];
    resumeCurrentPublish?: boolean;
  } | null;

  function handleOpenPreset(deck: DeckType) {
    setSearchParams({ deck: presetDeckParamId(deck) }, { state: { deckEditorFromList: true } });
  }

  const presetSavedDecksUnfiltered: SavedDeck[] = presetDecks.map((deck) => ({
    id: presetDeckParamId(deck),
    deck,
    savedAt: 0,
  }));
  const [draggedCard, setDraggedCard] = useState<DeckCard | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [importDialogOpen, setImportDialogOpen] = useState(() =>
    Boolean((location.state as { openImport?: boolean } | null)?.openImport),
  );
  const [choiceDialogOpen, setChoiceDialogOpen] = useState(false);
  const [selectedPublishingDeck, setPublishingDeck] = useState<SavedDeck | null>(null);
  const [hubPreviewId, setHubPreviewId] = useState<string | null>(null);
  const routePublishingDeck =
    publishEnabled && routeState?.resumePublishDeck
      ? {
          deck: routeState.resumePublishDeck,
          localDeckId: routeState.resumePublishDeckId ?? null,
        }
      : null;
  const publishingDeck = selectedPublishingDeck
    ? { deck: selectedPublishingDeck.deck, localDeckId: selectedPublishingDeck.id }
    : routePublishingDeck;

  const [previewSlot, setPreviewSlot] = useState<HTMLDivElement | null>(null);
  const [previewCollapsed, setPreviewCollapsed] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("deckEditor.previewRailCollapsed") === "true",
  );
  function togglePreview() {
    setPreviewCollapsed((v) => {
      const next = !v;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("deckEditor.previewRailCollapsed", String(next));
      }
      return next;
    });
  }
  const hasUnsavedChanges = useDeckUnsavedChanges();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentDeckId = useDeckStore((s) => s.currentDeckId);

  const [stateView, setStateView] = useState<"list" | "editor">(() => {
    if (useDeckStore.getState().isReadOnly) return "editor";
    return routeState?.directToEditor || (publishEnabled && routeState?.resumeCurrentPublish)
      ? "editor"
      : "list";
  });
  const view = isReadOnly ? "editor" : stateView;
  const setView = setStateView;
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [deletingAccountDeck, setDeletingAccountDeck] = useState<SavedDeck | null>(null);
  const [deletingAccountBusy, setDeletingAccountBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const blocker = useBlocker(hasUnsavedChanges && view === "editor" && !isReadOnly);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    return () => {
      useDeckStore.getState().clearDeck();
    };
  }, []);

  const restoredParamRef = useRef<string | null>(null);

  useEffect(() => {
    const deckParam = searchParams.get("deck");
    if (!deckParam) {
      const closedQueryEditor = restoredParamRef.current !== null;
      restoredParamRef.current = null;
      if (closedQueryEditor) {
        clearDeck();
        setStateView("list");
        return;
      }
      if (!isReadOnly && stateView === "editor" && currentDeckId) {
        setSearchParams({ deck: currentDeckId }, { replace: true, state: routeState ?? undefined });
      }
      return;
    }
    if (restoredParamRef.current === deckParam) {
      if (!isReadOnly && currentDeckId && currentDeckId !== deckParam) {
        restoredParamRef.current = currentDeckId;
        setSearchParams({ deck: currentDeckId }, { replace: true, state: routeState ?? undefined });
      } else if (!isReadOnly && !currentDeckId) {
        restoredParamRef.current = null;
        setSearchParams({}, { replace: true, state: routeState ?? undefined });
      }
      return;
    }

    if (deckParam.startsWith(PRESET_DECK_ID_PREFIX)) {
      const presetId = deckParam.slice(PRESET_DECK_ID_PREFIX.length);
      const preset = presetDecks.find((d) => (d.id ?? d.name) === presetId);
      if (!preset) return;
      loadPresetDeck(preset);
      setStateView("editor");
      restoredParamRef.current = deckParam;
      return;
    }

    const saved = savedDecks.find((s) => s.id === deckParam);
    if (!saved) return;
    loadSavedDeck(deckParam);
    setStateView("editor");
    restoredParamRef.current = deckParam;
  }, [
    searchParams,
    presetDecks,
    savedDecks,
    loadPresetDeck,
    loadSavedDeck,
    clearDeck,
    isReadOnly,
    stateView,
    currentDeckId,
    setSearchParams,
    routeState,
  ]);

  function toggleColor(color: string) {
    setColorFilter((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  }

  const deckFilterArgs = { search, formatFilter, colorFilter, sortBy };
  const { valid: presetSavedDecks } = applyDeckFilters(presetSavedDecksUnfiltered, deckFilterArgs);
  const localSavedDecks = savedDecks.filter((saved) => !saved.accountDeckId);
  const { valid: filteredValid, drafts: filteredDrafts } = applyDeckFilters(localSavedDecks, {
    search,
    formatFilter,
    colorFilter,
    sortBy,
  });
  const accountSavedDecks: SavedDeck[] = Object.values(accountDeckDetails).map((detail) => ({
    id: `account:${detail.id}`,
    deck: detail.deck as SavedDeck["deck"],
    savedAt: new Date(detail.updatedAt).getTime(),
    accountDeckId: detail.id,
    accountVersionNo: detail.currentVersionNo,
  }));
  const { valid: filteredAccountDecks, drafts: filteredAccountDrafts } = applyDeckFilters(
    accountSavedDecks,
    deckFilterArgs,
  );
  const filteredPublishedDecks = publishedDecks
    .filter((deck) => {
      if (search && !deck.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (formatFilter && (deck.format ?? "standard") !== formatFilter) return false;
      return colorFilter.every((color) => deck.colors.includes(color));
    })
    .slice()
    .sort((left, right) => {
      if (sortBy === "name") return left.name.localeCompare(right.name);
      if (sortBy === "color") return left.colors.localeCompare(right.colors);
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });

  function handleSelectDeck(id: string) {
    setSearchParams({ deck: id }, { state: { deckEditorFromList: true } });
  }

  function handleSelectAccountDeck(saved: SavedDeck) {
    if (!saved.accountDeckId || !saved.accountVersionNo) return;
    const id = loadAccountDeck(saved.accountDeckId, saved.accountVersionNo, saved.deck);
    setSearchParams({ deck: id }, { state: { deckEditorFromList: true } });
  }

  function viewPresetInHub(presetKey: string) {
    navigate(`${ROUTES.HUB}?deck=${encodeURIComponent(presetKey)}&source=presets`);
  }

  async function confirmDeleteAccountDeck() {
    const saved = deletingAccountDeck;
    if (!saved?.accountDeckId || deletingAccountBusy) return;
    setDeletingAccountBusy(true);
    try {
      await useAccountDecksStore.getState().remove(saved.accountDeckId);
      deleteSavedDeck(saved.id);
      toast.success(`"${saved.deck.name}" removed from your account`);
      setDeletingAccountDeck(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove account deck");
    } finally {
      setDeletingAccountBusy(false);
    }
  }

  async function handleSaveToAccount(saved: SavedDeck) {
    try {
      const detail = await useAccountDecksStore.getState().create(saved.deck, "Initial version");
      linkSavedDeckToAccount(
        saved.id,
        detail.id,
        detail.currentVersionNo,
        detail.deck as SavedDeck["deck"],
      );
      toast.success(`"${saved.deck.name}" saved to your account`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save deck to your account");
    }
  }

  function handleNewDeck() {
    setSearchParams({}, { replace: true, state: null });
    clearDeck();
    setDeckName(DEFAULT_DECK_NAME);
    setView("editor");
  }

  async function handleTextImport(
    entries: ParsedDeckEntry[],
    name: string,
    formatId: DeckFormat | undefined,
    onProgress: (fraction: number) => void,
  ) {
    const id = await importDeckText(entries, name, formatId, onProgress);
    handleSelectDeck(id);
  }

  function returnToDeckList() {
    const historyIndex = window.history.state?.idx;
    const popEditorEntry =
      routeState?.deckEditorFromList === true &&
      typeof historyIndex === "number" &&
      historyIndex > 0;
    setView("list");
    if (popEditorEntry) {
      navigate(-1);
    } else {
      setSearchParams({}, { replace: true, state: null });
    }
  }

  function handleBack() {
    if (isReadOnly) {
      useDeckStore.getState().clearDeck();
      returnToDeckList();
      return;
    }
    if (hasUnsavedChanges) {
      setShowBackConfirm(true);
    } else {
      returnToDeckList();
    }
  }

  useTopBarOverride({
    title: view === "editor" ? "Deck Editor" : undefined,
    onBack: view === "editor" ? handleBack : undefined,
  });

  useKeybindings({
    "card-search-focus": () => {
      setShowSearch(true);
      setSearchFocusSignal((n) => n + 1);
    },
    "deck-editor-toggle-preview": () => togglePreview(),
    "go-back": view === "editor" ? handleBack : () => navigate(ROUTES.PLAY),
  });

  function handleDelete(id: string) {
    deleteSavedDeck(id);
    toast.success("Deck deleted");
  }

  function startRename(id: string, name: string) {
    setRenamingId(id);
    setRenameInput(name);
  }

  function confirmRename() {
    if (!renamingId || !renameInput.trim()) return;
    const newName = renameInput.trim();
    useDeckStore.setState((state) => ({
      savedDecks: state.savedDecks.map((s) =>
        s.id === renamingId ? { ...s, deck: { ...s.deck, name: newName } } : s,
      ),
      currentDeck:
        state.currentDeckId === renamingId
          ? { ...state.currentDeck, name: newName }
          : state.currentDeck,
    }));
    setRenamingId(null);
    toast.success("Deck renamed");
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current;
    if (data?.card) setDraggedCard(data.card as DeckCard);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedCard(null);
    if (isReadOnly) return;
    const { active, over } = event;
    if (!over) return;

    const dragData = active.data.current;
    if (!dragData?.card) return;

    const card = dragData.card as DeckCard;
    const overId = String(over.id);
    const activeId = String(active.id);
    const cardName = (dragData.name as string) ?? card.identity.name;

    const sourceTagMatch = activeId.match(/^deck-tag-(.+?)-(?:.+)$/);
    const sourceTag = sourceTagMatch?.[1] ?? null;

    if (overId.startsWith(DROP_ZONE.TAG_PREFIX)) {
      const destTag = overId.slice(DROP_ZONE.TAG_PREFIX.length);
      if (sourceTag && sourceTag !== destTag) {
        untagCard(cardName, sourceTag);
      }
      tagCard(cardName, destTag);
    } else if (
      overId === DROP_ZONE.MAIN ||
      overId === DROP_ZONE.SIDE ||
      overId === DROP_ZONE.MAYBE
    ) {
      let source: "main" | "side" | "maybe" | "special" | "commander" = "main";
      if (activeId.startsWith("deck-sideboard-")) source = "side";
      else if (activeId.startsWith("deck-maybeboard-")) source = "maybe";
      else if (activeId.startsWith("deck-commander-")) source = "commander";
      else if (
        activeId.startsWith("deck-attractions-") ||
        activeId.startsWith("deck-contraptions-") ||
        activeId.startsWith("deck-schemes-") ||
        activeId.startsWith("deck-planes-")
      )
        source = "special";

      const dest: "main" | "side" | "maybe" =
        overId === DROP_ZONE.MAIN ? "main" : overId === DROP_ZONE.SIDE ? "side" : "maybe";

      const sourceZone = source === "side" || source === "special" ? "side" : source;
      if (sourceZone === dest) return;
      if (source === "commander") return;

      if (sourceTag) untagCard(cardName, sourceTag);

      const sourceList: DeckCard[] =
        source === "main"
          ? currentDeck.cards
          : source === "side"
            ? currentDeck.sideboard
            : source === "maybe"
              ? (currentDeck.maybeboard ?? [])
              : source === "special"
                ? [
                    ...(currentDeck.attractions ?? []),
                    ...(currentDeck.contraptions ?? []),
                    ...(currentDeck.schemes ?? []),
                    ...(currentDeck.planes ?? []),
                  ]
                : [];
      const one = [...sourceList].reverse().find((c) => c.identity.name === cardName);
      if (!one) return;

      if (source === "main") removeFromMain(one.identity.id);
      else if (source === "side" || source === "special") removeFromSide(one.identity.id);
      else if (source === "maybe") removeFromMaybe(one.identity.id);

      const fresh = { ...one, identity: { ...one.identity, id: crypto.randomUUID() } };
      if (dest === "main") addToMain(fresh);
      else if (dest === "side") addToSide(fresh);
      else if (dest === "maybe") addToMaybe(fresh);
    }
  }

  if (view === "list") {
    return (
      <>
        <div className="h-full flex flex-col">
          <DeckListControls
            search={search}
            onSearchChange={setSearch}
            formatFilter={formatFilter}
            onFormatChange={setFormatFilter}
            colorFilter={colorFilter}
            onColorToggle={toggleColor}
            sortBy={sortBy}
            onSortChange={setSortBy}
          />

          <ScrollArea className="flex-1">
            <div className="p-4 sm:px-6 lg:px-8">
              {accountDecksAvailable && accountDecksSignedIn && (
                <section className="mb-4 border-b pb-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Account decks
                    </span>
                    {!accountDecksLoading && (
                      <span className="text-[10px] text-muted-foreground">
                        ({filteredAccountDecks.length + filteredAccountDrafts.length})
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      disabled={accountDecksLoading}
                      onClick={() => void refreshAccountDecks()}
                    >
                      Refresh
                    </Button>
                  </div>
                  {accountDecksError ? (
                    <p className="text-sm text-destructive">{accountDecksError}</p>
                  ) : accountDecksLoading && accountSavedDecks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading account decks…</p>
                  ) : filteredAccountDecks.length + filteredAccountDrafts.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {[...filteredAccountDecks, ...filteredAccountDrafts].map((saved) => {
                        const presetKey = saved.accountDeckId
                          ? accountDeckDetails[saved.accountDeckId]?.derivedFromPresetKey
                          : undefined;
                        return (
                          <DeckGridCard
                            key={saved.id}
                            deck={saved}
                            onOpen={() => handleSelectAccountDeck(saved)}
                            onPlaytest={() => quickPlaytest(saved.deck)}
                            onDelete={() => setDeletingAccountDeck(saved)}
                            onPublish={publishEnabled ? () => setPublishingDeck(saved) : undefined}
                            onViewInHub={
                              hubEnabled && presetKey ? () => viewPresetInHub(presetKey) : undefined
                            }
                            onPlay={() => {
                              const id = saved.accountDeckId
                                ? loadAccountDeck(
                                    saved.accountDeckId,
                                    saved.accountVersionNo ?? 1,
                                    saved.deck,
                                  )
                                : saved.id;
                              navigate(`${ROUTES.PLAY_DECK}/${encodeURIComponent(id)}`);
                            }}
                            badge={presetKey ? "Preset copy" : undefined}
                          />
                        );
                      })}
                    </div>
                  ) : accountSavedDecks.length > 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No account decks match your filters.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Save or publish a local deck to add it to your account.
                    </p>
                  )}
                </section>
              )}

              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Local decks
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({localSavedDecks.length})
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => setChoiceDialogOpen(true)}
                    className={cn(
                      "aspect-[4/3] w-full rounded-lg border-2 border-dashed border-muted-foreground/30",
                      "flex flex-col items-center justify-center gap-1.5",
                      "cursor-pointer bg-muted/30 text-muted-foreground transition-all",
                      "group-hover:border-primary group-hover:bg-muted/60 group-hover:text-foreground",
                    )}
                  >
                    <Plus className="h-6 w-6" />
                    <span className="text-xs font-medium">Add deck</span>
                  </button>
                </div>

                {filteredValid.map((s) => (
                  <DeckGridCard
                    key={s.id}
                    deck={s}
                    onOpen={() => handleSelectDeck(s.id)}
                    onPlaytest={() => quickPlaytest(s.deck)}
                    onDelete={() => handleDelete(s.id)}
                    onRename={() => startRename(s.id, s.deck.name)}
                    onPublish={publishEnabled ? () => setPublishingDeck(s) : undefined}
                    onSaveToAccount={
                      accountDecksAvailable && accountDecksSignedIn
                        ? () => void handleSaveToAccount(s)
                        : undefined
                    }
                    onPlay={() => navigate(`${ROUTES.PLAY_DECK}/${encodeURIComponent(s.id)}`)}
                  />
                ))}
              </div>

              {filteredDrafts.length > 0 && (
                <div className={cn("mt-4", filteredValid.length > 0 && "border-t pt-4")}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Drafts
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      ({filteredDrafts.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {filteredDrafts.map((s) => (
                      <DeckGridCard
                        key={s.id}
                        deck={s}
                        onOpen={() => handleSelectDeck(s.id)}
                        onDelete={() => handleDelete(s.id)}
                        onRename={() => startRename(s.id, s.deck.name)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {publishEnabled && signedIn && (
                <div className="mt-4 border-t pt-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Published in Community
                    </span>
                    {!publishedDecksLoading && (
                      <span className="text-[10px] text-muted-foreground">
                        ({filteredPublishedDecks.length})
                      </span>
                    )}
                  </div>
                  {publishedDecksError ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
                      <span className="min-w-0 break-words">{publishedDecksError}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshPublishedDecks()}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : publishedDecksLoading && publishedDecks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Loading published decks…</p>
                  ) : publishedDecks.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        You haven’t published a deck yet. Use the share action on any local deck.
                      </span>
                      <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.HUB)}>
                        Browse Community
                      </Button>
                    </div>
                  ) : filteredPublishedDecks.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {filteredPublishedDecks.map((deck) => (
                        <HubDeckCard
                          key={deck.id}
                          deck={deck}
                          onOpen={() => setHubPreviewId(deck.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No published decks match your filters.
                    </p>
                  )}
                </div>
              )}

              {presetSavedDecks.length > 0 && (
                <div
                  className={cn(
                    "mt-4",
                    (filteredValid.length > 0 || filteredDrafts.length > 0) && "border-t pt-4",
                  )}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Starter Decks
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      ({presetSavedDecks.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {presetSavedDecks.map((s) => (
                      <DeckGridCard
                        key={s.id}
                        deck={s}
                        readOnly
                        onOpen={() => handleOpenPreset(s.deck)}
                        onPlaytest={() => quickPlaytest(s.deck)}
                        onViewInHub={
                          hubEnabled
                            ? () =>
                                navigate(
                                  `${ROUTES.HUB}?deck=${encodeURIComponent(s.deck.id ?? s.deck.name)}&source=presets`,
                                )
                            : undefined
                        }
                        badge="Official preset"
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredValid.length === 0 &&
                filteredDrafts.length === 0 &&
                presetSavedDecks.length === 0 &&
                savedDecks.length > 0 && (
                  <p className="col-span-5 pt-6 text-center text-sm text-muted-foreground">
                    No decks match your filters.
                  </p>
                )}
            </div>
          </ScrollArea>
        </div>

        <NewDeckChoiceDialog
          open={choiceDialogOpen}
          onOpenChange={setChoiceDialogOpen}
          onImport={() => {
            setChoiceDialogOpen(false);
            setImportDialogOpen(true);
          }}
          onFromScratch={() => {
            setChoiceDialogOpen(false);
            handleNewDeck();
          }}
        />

        <ImportDeckTextDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          onImport={handleTextImport}
        />

        {playtestDialog}

        {hubEnabled && (
          <HubDeckPreviewDialog
            deckId={hubPreviewId}
            onClose={() => setHubPreviewId(null)}
            onViewSnapshot={() => setView("editor")}
          />
        )}

        {publishEnabled && publishingDeck && (
          <PublishDeckDialog
            open
            onOpenChange={(open) => {
              if (!open) {
                setPublishingDeck(null);
                if (routeState?.resumePublishDeck) {
                  navigate(`${location.pathname}${location.search}`, { replace: true });
                }
              }
            }}
            deck={publishingDeck.deck}
            localDeckId={publishingDeck.localDeckId}
          />
        )}

        <Dialog
          open={renamingId !== null}
          onOpenChange={(open) => {
            if (!open) setRenamingId(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Rename Deck</DialogTitle>
            </DialogHeader>
            <Input
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmRename();
              }}
              placeholder="Deck name"
              autoFocus
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setRenamingId(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={confirmRename} disabled={!renameInput.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={deletingAccountDeck !== null}
          onOpenChange={(open) => {
            if (!open && !deletingAccountBusy) setDeletingAccountDeck(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remove account deck</DialogTitle>
              <DialogDescription>
                “{deletingAccountDeck?.deck.name}” and all its versions will be permanently removed
                from your account on every device. Publications of it in Community stay online.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={deletingAccountBusy}
                onClick={() => setDeletingAccountDeck(null)}
              >
                Keep deck
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={deletingAccountBusy}
                onClick={() => void confirmDeleteAccountDeck()}
              >
                {deletingAccountBusy ? "Removing…" : "Remove deck"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="h-full w-full overflow-hidden flex flex-col lg:flex-row">
          <div className="overflow-hidden flex-1 min-h-0 min-w-0">
            <DeckBuilder
              onToggleSearch={() => setShowSearch((v) => !v)}
              previewSlot={previewSlot}
              setPreviewSlot={setPreviewSlot}
              previewCollapsed={previewCollapsed}
              onTogglePreview={togglePreview}
              resumedPublication={
                publishEnabled && routeState?.resumeCurrentPublish ? routePublishingDeck : null
              }
              onResumedPublicationClose={() =>
                navigate(`${location.pathname}${location.search}`, {
                  replace: true,
                  state: { directToEditor: true },
                })
              }
            />
          </div>
          {showSearch && (
            <div className="flex-1 min-h-0 min-w-0 border-t lg:border-t-0 lg:border-l overflow-hidden">
              <CardSearch
                onClose={() => setShowSearch(false)}
                previewSlot={previewSlot}
                focusSignal={searchFocusSignal}
              />
            </div>
          )}
        </div>

        <DragOverlay dropAnimation={null}>
          {draggedCard && (
            <div className="w-24 opacity-90 rotate-3 shadow-2xl pointer-events-none">
              <CardThumbnail card={draggedCard} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {showBackConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/50 backdrop-blur-sm">
          <div className="bg-card border rounded-xl shadow-xl p-6 max-w-sm space-y-4">
            <h3 className="text-lg font-semibold">Unsaved Changes</h3>
            <p className="text-sm text-muted-foreground">
              You have unsaved changes to your deck. Do you want to go back without saving?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowBackConfirm(false)}>
                Stay
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  revertDeckToLastSaved();
                  setShowBackConfirm(false);
                  returnToDeckList();
                }}
              >
                Leave Without Saving
              </Button>
            </div>
          </div>
        </div>
      )}

      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/50 backdrop-blur-sm">
          <div className="bg-card border rounded-xl shadow-xl p-6 max-w-sm space-y-4">
            <h3 className="text-lg font-semibold">Unsaved Changes</h3>
            <p className="text-sm text-muted-foreground">
              You have unsaved changes to your deck. Do you want to leave without saving?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => blocker.reset()}>
                Stay
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  revertDeckToLastSaved();
                  blocker.proceed();
                }}
              >
                Leave Without Saving
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
