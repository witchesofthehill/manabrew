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
  useDroppable,
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
import { Bookmark, HelpCircle, Layers, Plus } from "lucide-react";
import { toast } from "sonner";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import type { ParsedDeckEntry } from "@/lib/deckImport";
import { useDeckTextImport } from "@/components/editor/useDeckTextImport";
import { applyDeckFilters, presetDeckParamId, PRESET_DECK_ID_PREFIX } from "@/views/myDecks.utils";
import type { SortBy } from "@/views/myDecks.utils";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useQuickPlaytest } from "@/hooks/useQuickPlaytest";
import { useMyDeckHubEntries } from "@/hooks/useMyDeckHubEntries";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useNavigate } from "react-router";
import type { SavedDeck } from "@/stores/useDeckStore";
import { DeckHubEntryCard } from "@/components/deck/DeckHubEntryCard";
import { HubDeckPreviewDialog } from "@/components/deck/HubDeckPreviewDialog";
import { isCommanderEligible, canBeOathbreaker, canBeSignatureSpell } from "@/lib/formats";

const DRAG_TRAY_MAIN = "drag-tray-main";
const DRAG_TRAY_SIDE = "drag-tray-side";
const DRAG_TRAY_MAYBE = "drag-tray-maybe";
const DRAG_TRAY_TAG_PREFIX = "drag-tray-tag:";
const DRAG_TRAY_NEW_TAG = "drag-tray-new-tag";

function DragTrayTarget({
  id,
  label,
  icon: Icon,
}: {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-14 min-w-28 flex-1 items-center justify-center gap-2 rounded-lg border border-dashed bg-background/90 px-3 py-2 text-xs font-medium shadow-sm transition-all",
        isOver ? "scale-105 border-primary bg-primary/15 text-primary" : "border-border",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </div>
  );
}

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
    addCustomTag,
    setCommander,
    removeCommander,
    savedDecks,
    loadSavedDeck,
    clearDeck,
    setDeckName,
    deleteSavedDeck,
    currentDeckId: _currentDeckId,
    loadAccountDeck,
  } = useDeckStore();
  const importDeckText = useDeckTextImport();
  const isReadOnly = useDeckStore((s) => s.isReadOnly);
  const loadPresetDeck = useDeckStore((s) => s.loadPresetDeck);
  const presetDecks = usePresetDecks();
  const { quickPlaytest, playtestDialog } = useQuickPlaytest();
  const {
    entries: publishedDecks,
    loading: publishedDecksLoading,
    error: publishedDecksError,
    signedIn,
    refresh: refreshPublishedDecks,
  } = useMyDeckHubEntries();
  const {
    details: accountDeckDetails,
    loading: accountDecksLoading,
    error: accountDecksError,
    available: accountDecksAvailable,
    signedIn: accountDecksSignedIn,
    resolved: accountDecksResolved,
    refresh: refreshAccountDecks,
  } = useAccountDecks();
  const authStatus = useAuthStore((state) => state.status);
  const navigate = useNavigate();
  const hubEnabled = isFeatureEnabled("deckHub");
  const publishEnabled = hubEnabled && isFeatureEnabled("accounts");
  const location = useLocation();
  const selectedCardsRef = useRef<ReadonlySet<string>>(new Set());
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

  const forkedPresetKeys = new Set(
    Object.values(accountDeckDetails)
      .map((detail) => detail.derivedFromPresetKey?.toLowerCase())
      .filter((key): key is string => key !== undefined),
  );
  const presetSavedDecksUnfiltered: SavedDeck[] = presetDecks
    .filter((deck) => !forkedPresetKeys.has((deck.id ?? "").toLowerCase()))
    .map((deck) => ({
      id: presetDeckParamId(deck),
      deck,
      savedAt: 0,
    }));
  const presetEnginesBySavedId = new Map(
    presetDecks.map((deck) => [presetDeckParamId(deck), deck.engines]),
  );
  const [draggedCards, setDraggedCards] = useState<DeckCard[]>([]);
  const [newTagDropOpen, setNewTagDropOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [pendingTagCards, setPendingTagCards] = useState<string[]>([]);
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
  const accountSavedDecks: SavedDeck[] = Object.values(accountDeckDetails).map((detail) => ({
    id: `account:${detail.id}`,
    deck: detail.deck as SavedDeck["deck"],
    savedAt: new Date(detail.updatedAt).getTime(),
    accountDeckId: detail.id,
    accountVersionNo: detail.currentVersionNo,
  }));
  const collectionPending =
    (isFeatureEnabled("accounts") && authStatus === "unknown") ||
    (accountDecksSignedIn && !accountDecksResolved);
  const collectionDecks = collectionPending
    ? []
    : accountDecksAvailable && accountDecksSignedIn
      ? [...accountSavedDecks, ...localSavedDecks]
      : localSavedDecks;
  const { valid: filteredCollectionDecks, drafts: filteredCollectionDrafts } = applyDeckFilters(
    collectionDecks,
    deckFilterArgs,
  );
  const filteredPublishedDecks = publishedDecks
    .filter((deck) => {
      if (search && !deck.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (formatFilter && (deck.format ?? "standard") !== formatFilter) return false;
      return colorFilter.every((color) => deck.colors.includes(color));
    })
    .slice()
    .sort((left, right) => {
      if (sortBy === "name") return left.title.localeCompare(right.title);
      if (sortBy === "color") return left.colors.localeCompare(right.colors);
      return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
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

  function renderCollectionDeck(saved: SavedDeck, draft = false) {
    const accountDeckId = saved.accountDeckId;
    const presetKey = accountDeckId
      ? accountDeckDetails[accountDeckId]?.derivedFromPresetKey
      : undefined;
    const accountDeck = accountDeckId !== undefined;
    return (
      <DeckGridCard
        key={saved.id}
        deck={saved}
        onOpen={() => (accountDeck ? handleSelectAccountDeck(saved) : handleSelectDeck(saved.id))}
        onPlaytest={draft ? undefined : () => quickPlaytest(saved.deck)}
        onDelete={() => (accountDeck ? setDeletingAccountDeck(saved) : handleDelete(saved.id))}
        onRename={accountDeck ? undefined : () => startRename(saved.id, saved.deck.name)}
        onPublish={!draft && publishEnabled ? () => setPublishingDeck(saved) : undefined}
        onViewInHub={hubEnabled && presetKey ? () => viewPresetInHub(presetKey) : undefined}
        onPlay={
          draft
            ? undefined
            : () => {
                const id = accountDeck
                  ? loadAccountDeck(accountDeckId, saved.accountVersionNo ?? 1, saved.deck)
                  : saved.id;
                navigate(`${ROUTES.PLAY_DECK}/${encodeURIComponent(id)}`);
              }
        }
        badge={
          presetKey
            ? "Preset copy"
            : accountDecksSignedIn && !accountDeck
              ? "Sync pending"
              : undefined
        }
      />
    );
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
    if (!data?.card) return;
    const card = data.card as DeckCard;
    const selectedCards = selectedCardsRef.current;
    if (!selectedCards.has(card.identity.name.toLowerCase())) {
      setDraggedCards([card]);
      return;
    }

    const allCards = [
      ...currentDeck.cards,
      ...currentDeck.sideboard,
      ...(currentDeck.maybeboard ?? []),
    ];
    const seen = new Set<string>();
    setDraggedCards(
      allCards.filter((candidate) => {
        const name = candidate.identity.name.toLowerCase();
        if (!selectedCards.has(name) || seen.has(name)) return false;
        seen.add(name);
        return true;
      }),
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedCards([]);
    if (isReadOnly) return;
    const { active, over } = event;
    if (!over) return;

    const dragData = active.data.current;
    if (!dragData?.card) return;

    const card = dragData.card as DeckCard;
    const overId = String(over.id);
    const activeId = String(active.id);
    const cardName = (dragData.name as string) ?? card.identity.name;
    const selectedCards = selectedCardsRef.current;
    const draggedNames = selectedCards.has(cardName.toLowerCase())
      ? [...selectedCards]
      : [cardName.toLowerCase()];

    const sourceTagMatch = activeId.match(/^deck-tag-(.+?)-(?:.+)$/);
    const sourceTag = sourceTagMatch?.[1] ?? null;

    if (overId === DROP_ZONE.COMMAND) {
      if (activeId.startsWith("deck-commander-")) return;
      const eligible =
        currentDeck.format === "oathbreaker"
          ? canBeOathbreaker(card) || canBeSignatureSpell(card)
          : isCommanderEligible(card);
      if (!eligible) {
        toast.error(`${card.identity.name} is not eligible for the command zone`);
        return;
      }
      setCommander(card);
      if (activeId.startsWith("deck-sideboard-")) removeFromSide(card.identity.id);
      else if (activeId.startsWith("deck-maybeboard-")) removeFromMaybe(card.identity.id);
      return;
    }

    if (overId === DRAG_TRAY_NEW_TAG) {
      setPendingTagCards(draggedNames);
      setNewTagName("");
      setNewTagDropOpen(true);
      return;
    }

    const trayTag = overId.startsWith(DRAG_TRAY_TAG_PREFIX)
      ? overId.slice(DRAG_TRAY_TAG_PREFIX.length)
      : null;

    if (overId.startsWith(DROP_ZONE.TAG_PREFIX) || trayTag) {
      const destTag = trayTag ?? overId.slice(DROP_ZONE.TAG_PREFIX.length);
      for (const name of draggedNames) {
        if (sourceTag && sourceTag !== destTag) {
          untagCard(name, sourceTag);
        }
        tagCard(name, destTag);
      }
    } else if (
      overId === DROP_ZONE.MAIN ||
      overId === DROP_ZONE.SIDE ||
      overId === DROP_ZONE.MAYBE ||
      overId === DRAG_TRAY_MAIN ||
      overId === DRAG_TRAY_SIDE ||
      overId === DRAG_TRAY_MAYBE
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
        overId === DROP_ZONE.MAIN || overId === DRAG_TRAY_MAIN
          ? "main"
          : overId === DROP_ZONE.SIDE || overId === DRAG_TRAY_SIDE
            ? "side"
            : "maybe";

      const sourceZone = source === "side" || source === "special" ? "side" : source;
      if (sourceZone === dest) return;
      if (source === "commander") {
        if (dest === "main") removeCommander(card);
        return;
      }

      if (draggedNames.length > 1) {
        for (const name of draggedNames) {
          const matchingCards = [
            ...(dest !== "main"
              ? currentDeck.cards.filter(
                  (candidate) => candidate.identity.name.toLowerCase() === name,
                )
              : []),
            ...(dest !== "side"
              ? currentDeck.sideboard.filter(
                  (candidate) => candidate.identity.name.toLowerCase() === name,
                )
              : []),
            ...(dest !== "maybe"
              ? (currentDeck.maybeboard ?? []).filter(
                  (candidate) => candidate.identity.name.toLowerCase() === name,
                )
              : []),
          ];

          for (const matchingCard of matchingCards) {
            if (
              currentDeck.cards.some(
                (candidate) => candidate.identity.id === matchingCard.identity.id,
              )
            )
              removeFromMain(matchingCard.identity.id);
            else if (
              currentDeck.sideboard.some(
                (candidate) => candidate.identity.id === matchingCard.identity.id,
              )
            )
              removeFromSide(matchingCard.identity.id);
            else removeFromMaybe(matchingCard.identity.id);

            const fresh = {
              ...matchingCard,
              identity: { ...matchingCard.identity, id: crypto.randomUUID() },
            };
            if (dest === "main") addToMain(fresh);
            else if (dest === "side") addToSide(fresh);
            else addToMaybe(fresh);
          }
        }
        return;
      }

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
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  My decks
                </span>
                <span className="text-[10px] text-muted-foreground">
                  ({collectionDecks.length})
                </span>
                {accountDecksAvailable && accountDecksSignedIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    disabled={accountDecksLoading}
                    onClick={() => void refreshAccountDecks()}
                  >
                    Refresh
                  </Button>
                )}
              </div>
              {accountDecksAvailable && accountDecksSignedIn && accountDecksError && (
                <p className="mb-3 text-sm text-destructive">{accountDecksError}</p>
              )}
              {(collectionPending ||
                (accountDecksAvailable &&
                  accountDecksSignedIn &&
                  accountDecksLoading &&
                  collectionDecks.length === 0)) && (
                <p className="mb-3 text-sm text-muted-foreground">Loading your decks…</p>
              )}
              {!collectionPending && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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

                  {filteredCollectionDecks.map((saved) => renderCollectionDeck(saved))}
                </div>
              )}

              {filteredCollectionDrafts.length > 0 && (
                <div className={cn("mt-4", filteredCollectionDecks.length > 0 && "border-t pt-4")}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Drafts
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      ({filteredCollectionDrafts.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {filteredCollectionDrafts.map((saved) => renderCollectionDeck(saved, true))}
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
                        You haven’t published a deck yet. Use the share action on any deck.
                      </span>
                      <Button variant="outline" size="sm" onClick={() => navigate(ROUTES.HUB)}>
                        Browse Community
                      </Button>
                    </div>
                  ) : filteredPublishedDecks.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                      {filteredPublishedDecks.map((deck) => (
                        <DeckHubEntryCard
                          key={deck.id}
                          entry={deck}
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
                    (filteredCollectionDecks.length > 0 || filteredCollectionDrafts.length > 0) &&
                      "border-t pt-4",
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
                        engines={presetEnginesBySavedId.get(s.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredCollectionDecks.length === 0 &&
                filteredCollectionDrafts.length === 0 &&
                presetSavedDecks.length === 0 &&
                collectionDecks.length > 0 && (
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
        onDragCancel={() => setDraggedCards([])}
      >
        <div className="h-full w-full overflow-hidden flex flex-col lg:flex-row">
          <div className="overflow-hidden flex-1 min-h-0 min-w-0">
            <DeckBuilder
              onSelectionChange={(selectedCards) => {
                selectedCardsRef.current = selectedCards;
              }}
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

        {draggedCards.length > 0 && (
          <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-area-inset-top)+4rem)] z-[80] flex justify-center px-4">
            <div className="pointer-events-auto flex max-w-5xl flex-wrap gap-2 rounded-xl border bg-popover/95 p-3 shadow-2xl backdrop-blur-md">
              <DragTrayTarget id={DRAG_TRAY_MAIN} label="Main deck" icon={Layers} />
              <DragTrayTarget id={DRAG_TRAY_SIDE} label="Sideboard" icon={Layers} />
              <DragTrayTarget id={DRAG_TRAY_MAYBE} label="Maybeboard" icon={HelpCircle} />
              {(currentDeck.customTags ?? []).map((tag) => (
                <DragTrayTarget
                  key={tag}
                  id={`${DRAG_TRAY_TAG_PREFIX}${tag}`}
                  label={tag}
                  icon={Bookmark}
                />
              ))}
              <DragTrayTarget id={DRAG_TRAY_NEW_TAG} label="New tag" icon={Plus} />
            </div>
          </div>
        )}

        <DragOverlay>
          {draggedCards.length > 0 && (
            <div className="relative h-36 w-36 pointer-events-none">
              {draggedCards.slice(0, 5).map((card, index) => {
                const visibleCards = Math.min(draggedCards.length, 5);
                const center = (visibleCards - 1) / 2;
                return (
                  <div
                    key={card.identity.id}
                    className="absolute left-5 top-1 w-24 origin-bottom shadow-2xl transition-transform"
                    style={{
                      transform: `translateX(${(index - center) * 13}px) translateY(${Math.abs(index - center) * 3}px) rotate(${(index - center) * 7}deg)`,
                      zIndex: index + 1,
                    }}
                  >
                    <CardThumbnail card={card} />
                  </div>
                );
              })}
              {draggedCards.length > 1 && (
                <div className="absolute right-0 top-0 z-20 flex h-7 min-w-7 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground shadow-lg">
                  {draggedCards.length}
                </div>
              )}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Dialog open={newTagDropOpen} onOpenChange={setNewTagDropOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Create tag</DialogTitle>
            <DialogDescription>
              Create a reusable tag and add the dropped cards to it.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newTagName}
            placeholder="Ramp, removal, combo…"
            onChange={(event) => setNewTagName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !newTagName.trim()) return;
              const tag = newTagName.trim();
              addCustomTag(tag);
              for (const name of pendingTagCards) tagCard(name, tag);
              setNewTagDropOpen(false);
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTagDropOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!newTagName.trim()}
              onClick={() => {
                const tag = newTagName.trim();
                addCustomTag(tag);
                for (const name of pendingTagCards) tagCard(name, tag);
                setNewTagDropOpen(false);
              }}
            >
              Create tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
