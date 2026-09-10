import { useDeckStore } from "@/stores/useDeckStore";
import { useNavigate } from "react-router-dom";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { fetchAccountDeck, HubRequestError } from "@/api/hub";
import { useGameDevStore } from "@/stores/useGameDevStore";
import { PublishDeckDialog } from "@/components/deck/PublishDeckDialog";
import { DeckVersionHistoryDialog } from "@/components/deck/DeckVersionHistoryDialog";
import { useKeybindings } from "@/hooks/useKeybindings";
import { Button } from "@/components/ui/button";
import { PrintPickerModal } from "./PrintPickerModal";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  X,
  Save,
  Trash2,
  Search,
  LayoutGrid,
  List,
  Layers,
  Plus,
  Loader2,
  ChevronDown,
  FileBox,
  ClipboardCopy,
  Share2,
  Palette,
  Bookmark,
  Group,
  EllipsisVertical,
  History,
  LibraryBig,
  ListPlus,
  Command as CommandIcon,
  Images,
  FoldVertical,
  UnfoldVertical,
  ArrowUp,
  Sparkles,
  BookOpen,
} from "lucide-react";
import { useState, useRef, useEffect, useCallback, useMemo, useDeferredValue } from "react";
import { toast } from "sonner";
import { showAccountSaveNudge } from "@/components/auth/accountSaveNudge";
import type { DeckCard, DeckCardIdentity } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";
import type { EditorDeck } from "@/types/manabrew";
import { useScryfallStore } from "@/stores/useScryfallStore";
import {
  deckCardToPreviewDto,
  frontFaceName,
  needsScryfallEnrichment,
  scryfallToDeckCard,
} from "@/lib/scryfall.utils";
import { DROP_ZONE, DEFAULT_DECK_NAME, ROUTES, STORAGE_KEYS } from "@/lib/constants";
import { parseDeckListText } from "@/lib/deckImport";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import {
  getFormat,
  validateDeckSections,
  canHaveAnyNumberOf,
  isCommanderEligible,
  canBePartners,
  canBePartnerCommander,
  canBeOathbreaker,
  canBeSignatureSpell,
  copyLimitFromText,
} from "@/lib/formats";
import { commanderSlotFor } from "./deckEditor.utils";
import { DeckListView } from "./DeckListView";
import { DeckHero } from "./DeckHero";
import { CardPreviewRail } from "@/components/game/CardPreviewRail";
import { useCardPreview } from "@/hooks/useCardPreview";
import { CardDetailModal } from "./CardDetailModal";
import { DeckLabelsModal } from "./DeckLabelsModal";
import { DeckValidationPanel } from "./DeckValidationPanel";
import { DeckBracketPanel } from "./DeckBracketPanel";
import { CombosPanel } from "./CombosPanel";
import { useDeckAnalysis } from "@/hooks/useDeckAnalysis";
import { useDeckRoles } from "@/hooks/useDeckRoles";
import { isFeatureEnabled } from "@/featureFlags";
import { useDeckSelection } from "./useDeckSelection";
import {
  type CardGroup,
  type ViewMode,
  type GroupByMode,
  type SortMode,
  GROUP_BY_OPTIONS,
  SORT_OPTIONS,
  CMC_BUCKET_LABELS,
  cmcBucketIndex,
  groupCards,
  computeGroupedSections,
  computeGroupedStackColumns,
  sortCardGroups,
  DEFAULT_CARD_SIZE,
  MAX_CARD_SIZE,
} from "./deckBuilder.utils";
import { exportToArena, exportWithPrintings } from "./deckExport";
import { TokenSection } from "./TokenSection";
import { useDerivedTokens, mergeDerivedAndCustomized } from "@/hooks/useDerivedTokens";
import {
  buildDeckSnapshot,
  setUnsavedState,
  setLastSavedDeckRef,
} from "./deckBuilder.unsavedChanges";
import { useUnsupportedCards } from "@/hooks/useUnsupportedCards";
import { CommanderSlots } from "./CommanderSlots";
import { ImportDeckTextDialog } from "./ImportDeckTextDialog";
import { useDeckTextImportIntoCurrent } from "./useDeckTextImport";
import {
  executeDeckEdit,
  redoDeckEdit,
  rebaseDeckHistory,
  resetDeckHistory,
  undoDeckEdit,
} from "./deckEditor.history";
import { DeckHistoryControls } from "./DeckHistoryControls";
import { DeckLayoutMenu } from "./DeckLayoutMenu";
import { setAllDeckSectionsExpanded, useDeckSectionOpen } from "./deckSectionExpansion";
import { DeckCommandPalette } from "./DeckCommandPalette";
import type { DeckEditorCommand } from "./deckEditor.commands";
import { DeckTagDialog } from "./DeckTagDialog";
import { matchesDeckQuery } from "./deckEditor.query";
import { DeckChangeSummary } from "./DeckChangeSummary";
import { DeckTagManagerDialog } from "./DeckTagManagerDialog";
import { BatchPrintingDialog } from "./BatchPrintingDialog";
import {
  moveCardCopies,
  moveSelectedCards,
  removeCardCopies,
  removeSelectedCards,
  type DeckSourceZone,
  type EditableDeckZone,
} from "./deckEditor.actions";
import { DeckQuickAdd } from "./DeckQuickAdd";
import { DeckSelectionTray } from "./DeckSelectionTray";
import { DeckCheckpointsDialog } from "./DeckCheckpointsDialog";
import { SideboardPlansDialog } from "./SideboardPlansDialog";
import { useCardCollection } from "@/hooks/useCardCollection";
import {
  collectionQuantityForName,
  deckOwnershipByName,
  type DeckOwnershipStatus,
} from "@/lib/collection";
import { useCollectionStore } from "@/stores/useCollectionStore";
import { normalizeCardName } from "@/lib/gameChangers";
import { useDeckAnalysisStore } from "@/stores/useDeckAnalysisStore";
import { DeckInsightsPanel } from "./DeckInsightsPanel";
import { DeckEditorWelcome } from "./DeckEditorWelcome";
import { openDeckEditorWelcome } from "./deckEditorWelcome.actions";
import { CardCollectionOwnershipScope } from "./useCardCollectionOwnership";
import { DeckSaveConflictDialog } from "./DeckSaveConflictDialog";
import { DeckStatusSummary } from "./DeckStatusSummary";
import { PrintingOptimizerDialog } from "./PrintingOptimizerDialog";
import { PreviewCardInfo } from "./PreviewCardInfo";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
type DeckSyncState = "saved" | "saving" | "local" | "synced" | "failed";
export function DeckBuilder({
  onToggleSearch,
  setPreviewSlot,
  previewCollapsed,
  onPreviewCollapsedChange,
  resumedPublication,
  onResumedPublicationClose,
  onSelectionChange,
  onReadOnlyDeckImported,
  previewController,
  onDeckDeleted,
}: {
  onToggleSearch?: () => void;
  setPreviewSlot?: (el: HTMLDivElement | null) => void;
  previewCollapsed?: boolean;
  onPreviewCollapsedChange?: (collapsed: boolean) => void;
  resumedPublication?: {
    deck: EditorDeck;
    localDeckId: string | null;
  } | null;
  onResumedPublicationClose?: () => void;
  onSelectionChange?: (selectedCards: ReadonlySet<string>) => void;
  onReadOnlyDeckImported?: (deckId: string) => void;
  previewController?: ReturnType<typeof useCardPreview>;
  onDeckDeleted?: () => void;
} = {}) {
  const navigate = useNavigate();
  const hubEnabled = isFeatureEnabled("deckHub");
  const accountsEnabled = isFeatureEnabled("accounts");
  const publishEnabled = hubEnabled && accountsEnabled;
  const [printPickerCard, setPrintPickerCard] = useState<DeckCard | null>(null);
  const [tokenPrintPicker, setTokenPrintPicker] = useState<DeckCard | null>(null);
  const [detailCard, setDetailCard] = useState<ScryfallCard | null>(null);
  const [detailToken, setDetailToken] = useState<DeckCard | null>(null);
  const [detailPrinting, setDetailPrinting] = useState<DeckCardIdentity | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [syncState, setSyncState] = useState<DeckSyncState>("saved");
  const [saveConflict, setSaveConflict] = useState<Awaited<
    ReturnType<typeof fetchAccountDeck>
  > | null>(null);
  const conflictDeckRef = useRef<EditorDeck | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [batchPrintingOpen, setBatchPrintingOpen] = useState(false);
  const [batchPrintingSelectionOnly, setBatchPrintingSelectionOnly] = useState(false);
  const [printingOptimizerOpen, setPrintingOptimizerOpen] = useState(false);
  const saveInFlightRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checkpointsOpen, setCheckpointsOpen] = useState(false);
  const [sideboardPlansOpen, setSideboardPlansOpen] = useState(false);
  const isReadOnly = useDeckStore((s) => s.isReadOnly);
  const readOnlySource = useDeckStore((s) => s.readOnlySource);
  const importReadOnlyDeck = useDeckStore((s) => s.importReadOnlyDeck);
  const currentDeckId = useDeckStore((s) => s.currentDeckId);
  const editorSessionId = useDeckStore((s) => s.editorSessionId);
  const {
    currentDeck,
    savedDecks,
    addToMain,
    addToSide,
    clearDeck,
    saveCurrentDeck,
    saveDraft,
    addToMaybe,
    deleteSavedDeck,
    enrichDeckCards,
    setCommander,
    removeCommander,
    addCustomTag,
    removeCustomTag,
    tagCard,
    untagCard,
    setCoverCard,
    setStackPositions,
    updatePrintingVariant,
    updateTokenPrint,
    toggleFoil,
    resetTokenPrint,
    updateAccountDeckVersion,
    linkSavedDeckToAccount,
    loadAccountDeck,
  } = useDeckStore();
  const allowIllegalDecks = useGameDevStore((s) => s.allowIllegalDecks);
  const importIntoCurrentDeck = useDeckTextImportIntoCurrent();
  const { selectedCards, toggleCard, rangeSelect, clearSelection, selectCards } =
    useDeckSelection();
  useEffect(() => {
    onSelectionChange?.(selectedCards);
  }, [onSelectionChange, selectedCards]);
  const derivedTokens = useDerivedTokens(currentDeck);
  const mergedTokens = useMemo(
    () => mergeDerivedAndCustomized(derivedTokens, currentDeck.tokens),
    [derivedTokens, currentDeck.tokens],
  );
  const [deckFilter, setDeckFilter] = useState("");
  const deferredDeckFilter = useDeferredValue(deckFilter);
  const [cmcFilter, setCmcFilter] = useState<number | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [announcement, setAnnouncement] = useState({ id: 0, message: "" });
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [cardSize, setCardSize] = useState(DEFAULT_CARD_SIZE);
  const [analysisOpen, setAnalysisOpen] = useDeckSectionOpen();
  const [groupBy, setGroupBy] = useState<GroupByMode>("type");
  const [sortBy, setSortBy] = useState<SortMode>("mana-value");
  const [collectionFilter, setCollectionFilter] = useState<"all" | DeckOwnershipStatus>("all");
  const [lastSavedDeck, setLastSavedDeck] = useState<EditorDeck>(() => {
    setLastSavedDeckRef(currentDeck);
    return currentDeck;
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const enrichedCardsRef = useRef(new Set<string>());
  const skipPresentationSaveRef = useRef(true);
  const presentationKey = currentDeckId ?? currentDeck.name.toLowerCase();
  useEffect(() => {
    skipPresentationSaveRef.current = true;
    try {
      const all = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.DECK_EDITOR_PRESENTATION) ?? "{}",
      ) as Record<
        string,
        Partial<{
          viewMode: ViewMode;
          cardSize: number;
          groupBy: GroupByMode;
          sortBy: SortMode;
          collectionFilter: "all" | DeckOwnershipStatus;
          analysisOpen: boolean;
        }>
      >;
      const saved = all[presentationKey];
      setViewMode(saved?.viewMode ?? "list");
      setCardSize(saved?.cardSize ?? DEFAULT_CARD_SIZE);
      setGroupBy(saved?.groupBy ?? "type");
      setSortBy(saved?.sortBy ?? "mana-value");
      setCollectionFilter(saved?.collectionFilter ?? "all");
      setAnalysisOpen(saved?.analysisOpen ?? true);
    } catch {
      localStorage.removeItem(STORAGE_KEYS.DECK_EDITOR_PRESENTATION);
      setViewMode("list");
      setCardSize(DEFAULT_CARD_SIZE);
      setGroupBy("type");
      setSortBy("mana-value");
      setCollectionFilter("all");
      setAnalysisOpen(true);
    }
  }, [editorSessionId, presentationKey, setAnalysisOpen]);
  useEffect(() => {
    if (skipPresentationSaveRef.current) {
      skipPresentationSaveRef.current = false;
      return;
    }
    const all = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.DECK_EDITOR_PRESENTATION) ?? "{}",
    ) as Record<string, unknown>;
    all[presentationKey] = {
      viewMode,
      cardSize,
      groupBy,
      sortBy,
      collectionFilter,
      analysisOpen,
    };
    localStorage.setItem(STORAGE_KEYS.DECK_EDITOR_PRESENTATION, JSON.stringify(all));
  }, [analysisOpen, cardSize, collectionFilter, groupBy, presentationKey, sortBy, viewMode]);
  useKeybindings({
    "deck-editor-focus-filter": () => {
      filterInputRef.current?.focus();
      filterInputRef.current?.select();
    },
    "deck-editor-toggle-search": () => onToggleSearch?.(),
    "deck-editor-save": () => void handleSave(),
    "deck-editor-export": () => handleExport(),
    "deck-editor-undo": undoDeckEdit,
    "deck-editor-redo": redoDeckEdit,
    "deck-editor-command-palette": () => setCommandPaletteOpen(true),
    "deck-editor-collapse-sections": () => setAllDeckSectionsExpanded(false),
    "deck-editor-expand-sections": () => setAllDeckSectionsExpanded(true),
    "deck-editor-next-section": () => jumpToNextEditorSection(),
    "deck-editor-tag-selection": () => {
      if (selectedCards.size > 0) setTagDialogOpen(true);
    },
    "deck-editor-select-all": () => selectAllDeckCards(),
    ...(selectedCards.size > 0
      ? { "deck-editor-copy-selection": () => void copySelectedCards() }
      : {}),
    "deck-editor-paste-cards": () => void pasteCards(),
    "deck-editor-remove-selection": () => {
      if (selectedCards.size > 0 && !isReadOnly) handleRemoveSelected();
    },
    "deck-editor-move-main": () => {
      if (selectedCards.size > 0 && !isReadOnly) handleMoveSelectedToMain();
    },
    "deck-editor-move-side": () => {
      if (selectedCards.size > 0 && !isReadOnly) handleMoveSelectedToSide();
    },
    "deck-editor-move-maybe": () => {
      if (selectedCards.size > 0 && !isReadOnly) handleMoveSelectedToMaybe();
    },
    "deck-editor-toggle-foil-selection": () => {
      if (selectedCards.size > 0 && !isReadOnly) toggleSelectedFoil();
    },
    "deck-editor-remove-one-selection": () => {
      if (selectedCards.size > 0 && !isReadOnly) removeOneEachSelected();
    },
    "deck-editor-add-one-selection": () => {
      if (selectedCards.size > 0 && !isReadOnly) addOneEachSelected();
    },
  });
  function jumpToNextEditorSection() {
    const sections =
      editorScrollRef.current?.querySelectorAll<HTMLElement>("[data-editor-section]");
    if (!sections?.length) return;
    const top = editorScrollRef.current!.getBoundingClientRect().top;
    const next = [...sections].find((section) => section.getBoundingClientRect().top > top + 48);
    (next ?? sections[0]).scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function navigateToDeckStatus(target: "validation" | "collection" | "budget") {
    if (target !== "validation") setAnalysisOpen(true);
    window.setTimeout(() => {
      const selector =
        target === "validation"
          ? "[data-editor-validation], [data-editor-section='build']"
          : `[data-editor-insight='${target}']`;
      editorScrollRef.current
        ?.querySelector<HTMLElement>(selector)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  const supplementaryCards = useMemo(
    () => [
      ...(currentDeck.commanders ?? []),
      ...currentDeck.sideboard,
      ...(currentDeck.maybeboard ?? []),
      ...(currentDeck.attractions ?? []),
      ...(currentDeck.contraptions ?? []),
      ...(currentDeck.schemes ?? []),
      ...(currentDeck.planes ?? []),
    ],
    [
      currentDeck.commanders,
      currentDeck.sideboard,
      currentDeck.maybeboard,
      currentDeck.attractions,
      currentDeck.contraptions,
      currentDeck.schemes,
      currentDeck.planes,
    ],
  );
  const currentSnapshot = useMemo(() => buildDeckSnapshot(currentDeck), [currentDeck]);
  const lastSavedSnapshot = useMemo(() => buildDeckSnapshot(lastSavedDeck), [lastSavedDeck]);
  const accountSavedDeck = savedDecks.find((saved) => saved.id === currentDeckId);
  // Read-only presets can't be edited; background Scryfall enrichment mutates the
  // deck after the baseline snapshot, so never treat a preset as dirty.
  const hasUnsavedChanges = !isReadOnly && currentSnapshot !== lastSavedSnapshot;
  useEffect(() => {
    setLastSavedDeckRef(lastSavedDeck);
    setUnsavedState(lastSavedSnapshot, isReadOnly ? lastSavedSnapshot : currentSnapshot);
  }, [lastSavedDeck, lastSavedSnapshot, currentSnapshot, isReadOnly]);
  useEffect(() => {
    const savedDeck = useDeckStore.getState().currentDeck;
    const snapshot = buildDeckSnapshot(savedDeck);
    setLastSavedDeck(savedDeck);
    setSyncState("saved");
    setSaveConflict(null);
    conflictDeckRef.current = null;
    setAnalysisOpen(true);
    setUnsavedState(snapshot, snapshot);
    resetDeckHistory();
    return resetDeckHistory;
  }, [editorSessionId, setAnalysisOpen]);
  // Warn on navigation/tab close with unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);
  const internalPreview = useCardPreview([], { subscribe: false });
  const preview = previewController ?? internalPreview;
  useDeckAnalysis();
  useDeckRoles();
  useCardCollection();
  const collectionQuantities = useCollectionStore((state) => state.quantities);
  const comboCardNames = useDeckAnalysisStore((state) => state.comboCardNames);
  const gameChangerNames = useDeckAnalysisStore((state) => state.gameChangerNames);
  const ownershipByName = useMemo(
    () =>
      deckOwnershipByName(collectionQuantities, [
        ...currentDeck.cards,
        ...(currentDeck.commanders ?? []),
        ...currentDeck.sideboard,
      ]),
    [collectionQuantities, currentDeck.cards, currentDeck.commanders, currentDeck.sideboard],
  );
  const collectionGapCount = useMemo(
    () =>
      [...ownershipByName.values()].filter(
        (ownership) => ownership.status === "missing" || ownership.status === "partial",
      ).length,
    [ownershipByName],
  );
  const isCardOwned = useCallback(
    (card: DeckCard) => collectionQuantityForName(collectionQuantities, card.identity.name) > 0,
    [collectionQuantities],
  );
  const { setNodeRef: setMainDropRef, isOver: isOverMain } = useDroppable({ id: DROP_ZONE.MAIN });
  const { setNodeRef: setSideDropRef, isOver: isOverSide } = useDroppable({ id: DROP_ZONE.SIDE });
  const { setNodeRef: setMaybeDropRef, isOver: isOverMaybe } = useDroppable({
    id: DROP_ZONE.MAYBE,
  });
  // Auto-enrich cards missing CMC/mana data, or missing the allParts / backFace
  // contract (legacy saved decks predate these fields).
  useEffect(() => {
    const allCards = [...currentDeck.cards, ...supplementaryCards];
    const toFetch = allCards
      .filter((card) => {
        const key = `${card.identity.name.toLowerCase()}::${card.identity.setCode.toLowerCase()}::${card.identity.cardNumber.toLowerCase()}`;
        return !enrichedCardsRef.current.has(key) && needsScryfallEnrichment(card);
      })
      .map((card) => ({
        name: card.identity.name,
        setCode: card.identity.setCode,
        collectorNumber: card.identity.cardNumber,
      }));
    if (toFetch.length === 0) return;
    const uniqueCards = [
      ...new Map(
        toFetch.map((card) => [
          `${card.name.toLowerCase()}::${card.setCode.toLowerCase()}::${card.collectorNumber.toLowerCase()}`,
          card,
        ]),
      ).values(),
    ];
    uniqueCards.forEach((card) =>
      enrichedCardsRef.current.add(
        `${card.name.toLowerCase()}::${card.setCode.toLowerCase()}::${card.collectorNumber.toLowerCase()}`,
      ),
    );
    useScryfallStore
      .getState()
      .fetchCardCollection(uniqueCards)
      .then((scryfallMap) => {
        const updates = new Map<string, Partial<DeckCard>>();
        for (const [key, sc] of scryfallMap) {
          const { identity: _identity, ...update } = scryfallToDeckCard(sc);
          updates.set(key, update);
        }
        const before = useDeckStore.getState().currentDeck;
        enrichDeckCards(updates);
        rebaseDeckHistory(before, useDeckStore.getState().currentDeck);
      })
      .catch((err) => {
        console.warn("[DeckBuilder] Failed to enrich card images:", err);
      });
  }, [currentDeck.cards, supplementaryCards, enrichDeckCards]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelection();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection]);
  function bulkAction(message: string, edit: () => void) {
    executeDeckEdit(message, edit);
    clearSelection();
    window.setTimeout(() => editorScrollRef.current?.focus({ preventScroll: true }));
    setAnnouncement((current) => ({ id: current.id + 1, message }));
    toast.success(message);
  }
  const handleRemoveSelected = () =>
    bulkAction(`Removed ${selectedCards.size} cards`, () => removeSelectedCards(selectedCards));
  const handleMoveSelectedToSide = () =>
    bulkAction(`Moved ${selectedCards.size} cards to sideboard`, () =>
      moveSelectedCards(selectedCards, "side"),
    );
  const handleMoveSelectedToMain = () =>
    bulkAction(`Moved ${selectedCards.size} cards to main`, () =>
      moveSelectedCards(selectedCards, "main"),
    );
  const handleMoveSelectedToMaybe = () =>
    bulkAction(`Moved ${selectedCards.size} cards to maybeboard`, () =>
      moveSelectedCards(selectedCards, "maybe"),
    );
  function allDeckCards() {
    return [
      ...currentDeck.cards,
      ...currentDeck.sideboard,
      ...(currentDeck.maybeboard ?? []),
      ...(currentDeck.attractions ?? []),
      ...(currentDeck.contraptions ?? []),
      ...(currentDeck.schemes ?? []),
      ...(currentDeck.planes ?? []),
    ];
  }
  function selectAllDeckCards() {
    selectCards(
      allDeckCards().map((card) => card.identity.name),
      true,
    );
  }
  function selectEditableCards(cardNames: Iterable<string>) {
    const editableNames = new Set(allDeckCards().map((card) => card.identity.name.toLowerCase()));
    selectCards(
      [...cardNames].filter((name) => editableNames.has(name.toLowerCase())),
      true,
    );
  }
  async function copySelectedCards() {
    if (selectedCards.size === 0) return;
    const counts = new Map<string, number>();
    for (const card of allDeckCards()) {
      if (!selectedCards.has(card.identity.name.toLowerCase())) continue;
      counts.set(card.identity.name, (counts.get(card.identity.name) ?? 0) + 1);
    }
    try {
      await navigator.clipboard.writeText(
        [...counts].map(([name, count]) => `${count} ${name}`).join("\n"),
      );
      toast.success(
        i18n._(msg`Copied ${counts.size} selected card${counts.size === 1 ? "" : "s"}`),
      );
    } catch {
      toast.error(i18n._(msg`Could not write selected cards to the clipboard`));
    }
  }
  async function pasteCards() {
    if (isReadOnly) return;
    try {
      const entries = parseDeckListText(await navigator.clipboard.readText());
      if (entries.length === 0) {
        toast.error(i18n._(msg`Clipboard does not contain a recognized card list`));
        return;
      }
      await importIntoCurrentDeck(entries, "", undefined, () => undefined);
    } catch {
      toast.error(i18n._(msg`Could not read cards from the clipboard`));
    }
  }
  function addOneEachSelected() {
    const store = useDeckStore.getState();
    const editableCards = [
      ...currentDeck.cards,
      ...currentDeck.sideboard,
      ...(currentDeck.maybeboard ?? []),
    ];
    let added = 0;
    executeDeckEdit(i18n._(msg`Add one copy of selected cards`), () => {
      for (const name of selectedCards) {
        const card = editableCards.find(
          (candidate) => candidate.identity.name.toLowerCase() === name,
        );
        if (!card) continue;
        const copy = { ...card, identity: { ...card.identity, id: crypto.randomUUID() } };
        if (currentDeck.sideboard.includes(card)) store.addToSide(copy);
        else if ((currentDeck.maybeboard ?? []).includes(card)) store.addToMaybe(copy);
        else store.addToMain(copy);
        added += 1;
      }
    });
    if (added > 0) toast.success(i18n._(msg`Added one copy of ${added} cards`));
    if (added < selectedCards.size) {
      toast.warning(i18n._(msg`Command-zone and special-section cards were not duplicated`));
    }
  }
  function removeOneEachSelected() {
    executeDeckEdit(i18n._(msg`Removed one copy of ${selectedCards.size} cards`), () => {
      for (const name of selectedCards) {
        for (const zone of ["main", "side", "maybe", "special"] as const) {
          if (removeCardCopies(name, zone, "one") > 0) break;
        }
      }
    });
    toast.success(i18n._(msg`Removed one copy of ${selectedCards.size} cards`));
  }
  function toggleSelectedFoil() {
    bulkAction(i18n._(msg`Toggled foil for ${selectedCards.size} cards`), () => {
      for (const name of selectedCards) toggleFoil(name);
    });
  }
  const handleTagSelected = (tag: string) =>
    bulkAction(i18n._(msg`Tagged ${selectedCards.size} cards with "${tag}"`), () => {
      for (const name of selectedCards) tagCard(name, tag);
    });
  const handleUntagSelected = (tag: string) =>
    bulkAction(i18n._(msg`Untagged ${selectedCards.size} cards from "${tag}"`), () => {
      for (const name of selectedCards) untagCard(name, tag);
    });
  const handleCreateAndTagSelected = (tag: string) => {
    executeDeckEdit(i18n._(msg`Create ${tag} and tag ${selectedCards.size} cards`), () => {
      addCustomTag(tag);
      for (const name of selectedCards) tagCard(name, tag);
    });
    clearSelection();
    toast.success(i18n._(msg`Tagged cards with "${tag}"`));
  };
  const selectedCardTags = (() => {
    if (selectedCards.size === 0 || !currentDeck.cardTags) return [];
    const tags = new Set<string>();
    for (const name of selectedCards) {
      const cardTagList = currentDeck.cardTags[name];
      if (cardTagList) cardTagList.forEach((t) => tags.add(t));
    }
    return [...tags];
  })();
  const unsupportedNames = useUnsupportedCards(currentDeck);
  const editableUnsupportedNames = new Set(
    [...unsupportedNames].filter((name) =>
      allDeckCards().some((card) => card.identity.name.toLowerCase() === name.toLowerCase()),
    ),
  );
  const hasUnsupportedCards = unsupportedNames.size > 0;
  const deckFormat = getFormat(currentDeck.format ?? "standard");
  const deckValidation = useMemo(
    () =>
      deckFormat
        ? validateDeckSections(
            {
              deck: currentDeck,
              commanderName: currentDeck.commanders?.[0]?.identity.name,
            },
            deckFormat,
          )
        : { legal: false, errors: [] as string[] },
    [currentDeck, deckFormat],
  );
  const isDeckLegal = deckValidation.legal;
  const matchesFilters = useCallback(
    (c: DeckCard, section: "main" | "sideboard" | "maybeboard" | "special" = "main") => {
      const tags = currentDeck.cardTags?.[c.identity.name.toLowerCase()] ?? [];
      const ownership = ownershipByName.get(c.identity.name.toLowerCase())?.status ?? "missing";
      if (collectionFilter !== "all" && ownership !== collectionFilter) return false;
      if (
        !matchesDeckQuery(c, deferredDeckFilter, {
          tags,
          unsupported: unsupportedNames.has(c.identity.name),
          ownership,
          combo: comboCardNames.has(normalizeCardName(c.identity.name)),
          gameChanger: gameChangerNames.has(normalizeCardName(c.identity.name)),
          section,
        })
      )
        return false;
      if (cmcFilter !== null && cmcBucketIndex(c) !== cmcFilter) return false;
      return true;
    },
    [
      currentDeck.cardTags,
      deferredDeckFilter,
      unsupportedNames,
      cmcFilter,
      ownershipByName,
      collectionFilter,
      comboCardNames,
      gameChangerNames,
    ],
  );
  const hasActiveFilter =
    deckFilter.trim().length > 0 || cmcFilter !== null || collectionFilter !== "all";
  const applyFilters = useCallback(
    (cards: DeckCard[], section: "main" | "sideboard" | "maybeboard" | "special" = "main") =>
      hasActiveFilter ? cards.filter((card) => matchesFilters(card, section)) : cards,
    [hasActiveFilter, matchesFilters],
  );
  const filteredMain = useMemo(
    () => applyFilters(currentDeck.cards),
    [applyFilters, currentDeck.cards],
  );
  const { sectionGroups, otherGroups, sideGroups, maybeGroups, specialSections } = useMemo(() => {
    const groupedMain = computeGroupedSections(
      filteredMain,
      groupBy,
      currentDeck.customTags,
      currentDeck.cardTags,
    );
    const groupZone = (cards: DeckCard[], section: "sideboard" | "maybeboard" | "special") =>
      sortCardGroups(groupCards(applyFilters(cards, section)), sortBy, isCardOwned);
    return {
      sectionGroups: groupedMain.sections.map((section) => ({
        ...section,
        groups: sortCardGroups(section.groups, sortBy, isCardOwned),
      })),
      otherGroups: sortCardGroups(groupedMain.otherGroups, sortBy, isCardOwned),
      sideGroups: groupZone(currentDeck.sideboard, "sideboard"),
      maybeGroups: groupZone(currentDeck.maybeboard ?? [], "maybeboard"),
      specialSections: [
        {
          id: "attractions",
          get label() {
            return i18n._(msg`Attractions`);
          },
          groups: groupZone(currentDeck.attractions ?? [], "special"),
        },
        {
          id: "contraptions",
          get label() {
            return i18n._(msg`Contraptions`);
          },
          groups: groupZone(currentDeck.contraptions ?? [], "special"),
        },
        {
          id: "schemes",
          get label() {
            return i18n._(msg`Schemes`);
          },
          groups: groupZone(currentDeck.schemes ?? [], "special"),
        },
        {
          id: "planes",
          get label() {
            return i18n._(msg`Planes`);
          },
          groups: groupZone(currentDeck.planes ?? [], "special"),
        },
      ].filter((section) => section.groups.length > 0),
    };
  }, [
    applyFilters,
    currentDeck.attractions,
    currentDeck.cardTags,
    currentDeck.contraptions,
    currentDeck.customTags,
    currentDeck.maybeboard,
    currentDeck.planes,
    currentDeck.schemes,
    currentDeck.sideboard,
    filteredMain,
    groupBy,
    isCardOwned,
    sortBy,
  ]);
  const stackColsData = useMemo(
    () =>
      computeGroupedStackColumns(
        filteredMain,
        groupBy,
        currentDeck.customTags,
        currentDeck.cardTags,
      ).map((section) => ({
        ...section,
        groups: sortCardGroups(section.groups, sortBy, isCardOwned),
      })),
    [filteredMain, groupBy, sortBy, currentDeck.customTags, currentDeck.cardTags, isCardOwned],
  );
  function removeCopies(cardName: string, source: DeckSourceZone, quantity: "one" | "all") {
    executeDeckEdit(
      quantity === "one"
        ? i18n._(msg`Remove one ${cardName}`)
        : i18n._(msg`Remove all ${cardName}`),
      () => removeCardCopies(cardName, source, quantity),
    );
  }
  function moveCopies(
    cardName: string,
    source: EditableDeckZone,
    destination: EditableDeckZone,
    quantity: "one" | "all",
  ) {
    let moved = 0;
    executeDeckEdit(i18n._(msg`Move ${cardName} to ${destination}`), () => {
      moved = moveCardCopies(cardName, source, destination, quantity);
    });
    if (moved > 0) {
      const label = destination === "main" ? i18n._(msg`main`) : i18n._(msg`${destination}board`);
      toast.success(i18n._(msg`Moved ${moved} ${cardName} to ${label}`));
    }
  }
  function handleRemoveOneFromMain(cardName: string) {
    removeCopies(cardName, "main", "one");
  }
  function handleRemoveAllFromMain(cardName: string) {
    removeCopies(cardName, "main", "all");
  }
  function handleMoveOneToSide(cardName: string) {
    moveCopies(cardName, "main", "side", "one");
  }
  function handleMoveAllToSide(cardName: string) {
    moveCopies(cardName, "main", "side", "all");
  }
  function handleMoveOneToMaybe(cardName: string) {
    moveCopies(cardName, "main", "maybe", "one");
  }
  function handleMoveAllToMaybe(cardName: string) {
    moveCopies(cardName, "main", "maybe", "all");
  }
  function handleRemoveOneFromMaybe(cardName: string) {
    removeCopies(cardName, "maybe", "one");
  }
  function handleShowInfo(deckCard: DeckCard) {
    setDetailToken(null);
    setDetailPrinting(deckCard.identity);
    useScryfallStore
      .getState()
      .getCard({
        name: deckCard.identity.name,
        setCode: deckCard.identity.setCode,
        collectorNumber: deckCard.identity.cardNumber,
      })
      .then((sc) => setDetailCard(sc.info))
      .catch(() => toast.error(i18n._(msg`Could not fetch info for "${deckCard.identity.name}"`)));
  }
  function handleShowTokenInfo(token: DeckCard) {
    useScryfallStore
      .getState()
      .getCard({
        setCode: token.identity.setCode,
        collectorNumber: token.identity.cardNumber,
      })
      .then((sc) => {
        setDetailToken(token);
        setDetailPrinting(null);
        setDetailCard(sc.info);
      })
      .catch(() => toast.error(i18n._(msg`Could not fetch info for "${token.identity.name}"`)));
  }
  function handleRemoveOneFromSide(cardName: string) {
    const source = currentDeck.sideboard.some((card) => card.identity.name === cardName)
      ? "side"
      : "special";
    removeCopies(cardName, source, "one");
  }
  function handleMoveOneFromSideToMain(cardName: string) {
    moveCopies(cardName, "side", "main", "one");
  }
  function handleMoveAllFromSideToMain(cardName: string) {
    moveCopies(cardName, "side", "main", "all");
  }
  function handleMoveOneFromSideToMaybe(cardName: string) {
    moveCopies(cardName, "side", "maybe", "one");
  }
  function handleMoveAllFromSideToMaybe(cardName: string) {
    moveCopies(cardName, "side", "maybe", "all");
  }
  function handleMoveOneFromMaybeToMain(cardName: string) {
    moveCopies(cardName, "maybe", "main", "one");
  }
  function handleMoveAllFromMaybeToMain(cardName: string) {
    moveCopies(cardName, "maybe", "main", "all");
  }
  function handleMoveOneFromMaybeToSide(cardName: string) {
    moveCopies(cardName, "maybe", "side", "one");
  }
  function handleMoveAllFromMaybeToSide(cardName: string) {
    moveCopies(cardName, "maybe", "side", "all");
  }
  function handleSetCommander(card: DeckCard) {
    if (currentDeck.format === "oathbreaker") {
      if (!canBeOathbreaker(card) && !canBeSignatureSpell(card)) {
        toast.warning(
          i18n._(
            msg`"${card.identity.name}" is not a legal oathbreaker or signature spell — an oathbreaker must be a planeswalker, a signature spell an instant or sorcery`,
          ),
        );
        return;
      }
      executeDeckEdit(i18n._(msg`Set ${card.identity.name} in the command zone`), () =>
        setCommander(card),
      );
      return;
    }
    if (!isCommanderEligible(card)) {
      toast.warning(i18n._(msg`"${card.identity.name}" is not a legal commander`));
      return;
    }
    const existing = currentDeck.commanders ?? [];
    if (existing.length >= 1 && !canBePartners(existing[0], card)) {
      // Incompatible pairing — explain why before the store silently replaces
      const existingHasPartner = canBePartnerCommander(existing[0]);
      const newHasPartner = canBePartnerCommander(card);
      if (!existingHasPartner && !newHasPartner) {
        toast.info(
          i18n._(
            msg`"${existing[0].identity.name}" replaced — neither commander has a partner ability`,
          ),
        );
      } else if (!existingHasPartner) {
        toast.info(
          i18n._(msg`"${existing[0].identity.name}" replaced — it doesn't have a partner ability`),
        );
      } else if (!newHasPartner) {
        toast.info(
          i18n._(
            msg`"${card.identity.name}" set as sole commander — it doesn't have a partner ability`,
          ),
        );
      } else {
        toast.info(
          i18n._(
            msg`"${existing[0].identity.name}" replaced — "${card.identity.name}" must partner with a different card`,
          ),
        );
      }
    }
    executeDeckEdit(i18n._(msg`Set ${card.identity.name} as commander`), () => setCommander(card));
  }
  function handleRemoveCommander(card?: DeckCard) {
    executeDeckEdit(
      card
        ? i18n._(msg`Remove ${card.identity.name} from the command zone`)
        : i18n._(msg`Remove commander`),
      () => removeCommander(card),
    );
  }
  function isAtCopyLimit(cardName: string): boolean {
    if (allowIllegalDecks) return false;
    const format = getFormat(currentDeck.format ?? "standard");
    if (!format) return false;
    const copies = currentDeck.cards.filter((c) => c.identity.name === cardName);
    if (copies.length === 0) return false;
    if (canHaveAnyNumberOf(copies[0])) return false;
    const limit = copyLimitFromText(copies[0].text) ?? format.deckRules.maxCopies;
    return copies.length >= limit;
  }
  function handleAddOneToMain(group: CardGroup) {
    if (isAtCopyLimit(group.card.identity.name)) {
      const format = getFormat(currentDeck.format ?? "standard");
      const formatName = format?.name ?? currentDeck.format ?? i18n._(msg`this format`);
      toast.error(
        i18n._(
          msg`Max ${format?.deckRules.maxCopies ?? 0} copies of "${group.card.identity.name}" allowed in ${formatName}`,
        ),
      );
      return;
    }
    executeDeckEdit(i18n._(msg`Add ${group.card.identity.name}`), () =>
      addToMain({ ...group.card, identity: { ...group.card.identity, id: crypto.randomUUID() } }),
    );
  }
  function handleAddOneToMainByName(cardName: string) {
    if (isAtCopyLimit(cardName)) {
      const format = getFormat(currentDeck.format ?? "standard");
      const formatName = format?.name ?? currentDeck.format ?? i18n._(msg`this format`);
      toast.error(
        i18n._(
          msg`Max ${format?.deckRules.maxCopies ?? 0} copies of "${cardName}" allowed in ${formatName}`,
        ),
      );
      return;
    }
    const existing = currentDeck.cards.find((c) => c.identity.name === cardName);
    if (existing) {
      executeDeckEdit(i18n._(msg`Add ${cardName}`), () =>
        addToMain({ ...existing, identity: { ...existing.identity, id: crypto.randomUUID() } }),
      );
    }
  }
  function handleExport() {
    const text = exportToArena(currentDeck);
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(i18n._(msg`Deck copied to clipboard`)));
  }
  function handleExactExport() {
    navigator.clipboard
      .writeText(exportWithPrintings(currentDeck))
      .then(() => toast.success(i18n._(msg`Exact printings copied to clipboard`)))
      .catch(() => toast.error(i18n._(msg`Could not write to the clipboard`)));
  }
  async function handleSave(deckOverride?: EditorDeck, quiet = false) {
    if (saveInFlightRef.current) return;
    const sourceDeck = deckOverride ?? currentDeck;
    const normalizedName = sourceDeck.name.trim();
    if (!normalizedName) {
      toast.error(i18n._(msg`Give this deck a name before saving`));
      return;
    }
    // A full save always clears the draft flag; keeping it here used to leak
    // `draft: true` into the account snapshot, which then re-infected the
    // local copy via the server echo and left the deck stuck in Drafts.
    const deckToSave = { ...sourceDeck, name: normalizedName, draft: undefined };
    if (normalizedName !== sourceDeck.name) useDeckStore.getState().setDeckName(normalizedName);
    saveInFlightRef.current = true;
    setIsSaving(true);
    setSyncState("saving");
    try {
      const saved = savedDecks.find((candidate) => candidate.id === currentDeckId);
      saveCurrentDeck();
      const snapshot = buildDeckSnapshot(deckToSave);
      setLastSavedDeck(deckToSave);
      setUnsavedState(snapshot, snapshot);
      if (accountsEnabled && saved?.accountDeckId && saved.accountVersionNo) {
        const detail = await useAccountDecksStore
          .getState()
          .save(saved.accountDeckId, saved.accountVersionNo, deckToSave);
        const latestDeck = useDeckStore.getState().currentDeck;
        const changedDuringSave = buildDeckSnapshot(latestDeck) !== snapshot;
        const beforeAccountUpdate = useDeckStore.getState().currentDeck;
        updateAccountDeckVersion(detail.id, detail.currentVersionNo, detail.deck as EditorDeck);
        if (changedDuringSave) useDeckStore.setState({ currentDeck: latestDeck });
        else rebaseDeckHistory(beforeAccountUpdate, useDeckStore.getState().currentDeck);
        setSyncState("synced");
        if (!quiet)
          toast.success(i18n._(msg`Saved version ${detail.currentVersionNo} to your account`));
      } else {
        setSyncState("local");
        if (!quiet) showAccountSaveNudge();
      }
      if (!quiet && hasUnsupportedCards) {
        toast.warning(
          unsupportedNames.size === 1
            ? i18n._(
                msg`Saved "${deckToSave.name}" — one card is unsupported by the Manabrew and Forge engines`,
              )
            : i18n._(
                msg`Saved "${deckToSave.name}" — ${unsupportedNames.size} cards are unsupported by the Manabrew and Forge engines`,
              ),
        );
      } else if (!quiet && !deckValidation.legal) {
        const validationError =
          deckValidation.errors[0] ?? i18n._(msg`deck is not legal in this format`);
        toast.warning(i18n._(msg`Saved "${deckToSave.name}" — ${validationError}`));
      }
    } catch (error) {
      if (
        error instanceof HubRequestError &&
        error.status === 409 &&
        accountSavedDeck?.accountDeckId
      ) {
        conflictDeckRef.current = deckToSave;
        try {
          setSaveConflict(await fetchAccountDeck(accountSavedDeck.accountDeckId));
        } catch {
          setSyncState("failed");
          toast.error(
            i18n._(msg`The account version could not be loaded. Your local copy is still saved.`),
          );
        }
      } else {
        setSyncState("failed");
        if (!quiet) {
          toast.error(
            error instanceof Error
              ? i18n._(msg`${error.message} Your local copy is still saved.`)
              : i18n._(msg`Account save failed. Your local copy is still saved.`),
          );
        }
      }
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }
  async function resolveSaveConflict(action: "mine" | "account" | "copy") {
    if (!saveConflict || !conflictDeckRef.current) return;
    setIsSaving(true);
    setSyncState("saving");
    try {
      if (action === "mine") {
        const detail = await useAccountDecksStore
          .getState()
          .save(saveConflict.id, saveConflict.currentVersionNo, conflictDeckRef.current);
        const beforeAccountUpdate = useDeckStore.getState().currentDeck;
        updateAccountDeckVersion(detail.id, detail.currentVersionNo, detail.deck as EditorDeck);
        rebaseDeckHistory(beforeAccountUpdate, useDeckStore.getState().currentDeck);
      } else if (action === "account") {
        loadAccountDeck(
          saveConflict.id,
          saveConflict.currentVersionNo,
          saveConflict.deck as EditorDeck,
        );
      } else {
        const copy = await useAccountDecksStore.getState().create({
          ...conflictDeckRef.current,
          name: i18n._(msg`${conflictDeckRef.current.name} copy`),
        });
        linkSavedDeckToAccount(
          currentDeckId,
          copy.id,
          copy.currentVersionNo,
          copy.deck as EditorDeck,
        );
      }
      const savedDeck = useDeckStore.getState().currentDeck;
      const snapshot = buildDeckSnapshot(savedDeck);
      setLastSavedDeck(savedDeck);
      setUnsavedState(snapshot, snapshot);
      setSyncState("synced");
      setSaveConflict(null);
      conflictDeckRef.current = null;
      toast.success(
        action === "copy"
          ? i18n._(msg`Saved as a separate account deck`)
          : i18n._(msg`Deck conflict resolved`),
      );
    } catch (error) {
      setSyncState("failed");
      toast.error(
        error instanceof Error ? error.message : i18n._(msg`Could not resolve the deck conflict`),
      );
    } finally {
      setIsSaving(false);
    }
  }
  function handleSaveDraft() {
    saveDraft();
    const savedDeck = { ...currentDeck, draft: true };
    const snapshot = buildDeckSnapshot(savedDeck);
    setLastSavedDeck(savedDeck);
    setUnsavedState(snapshot, snapshot);
    if (hasUnsupportedCards) {
      toast.warning(
        unsupportedNames.size === 1
          ? i18n._(
              msg`Saved "${currentDeck.name}" as draft — one card is unsupported by the Manabrew and Forge engines`,
            )
          : i18n._(
              msg`Saved "${currentDeck.name}" as draft — ${unsupportedNames.size} cards are unsupported by the Manabrew and Forge engines`,
            ),
      );
    } else {
      toast.success(i18n._(msg`Draft "${currentDeck.name}" saved`));
    }
  }
  async function handleDeleteCurrentDeck() {
    if (isDeleting) return;
    const deckId = useDeckStore.getState().currentDeckId;
    const saved = deckId ? savedDecks.find((candidate) => candidate.id === deckId) : undefined;
    setIsDeleting(true);
    try {
      if (saved?.accountDeckId) {
        await useAccountDecksStore.getState().remove(saved.accountDeckId);
      }
      if (deckId) deleteSavedDeck(deckId);
      clearDeck();
      resetDeckHistory();
      setConfirmClear(false);
      const savedDeck: EditorDeck = {
        format: "standard",
        cards: [],
        sideboard: [],
        commanders: [],
        attractions: [],
        contraptions: [],
        schemes: [],
        planes: [],
        name: DEFAULT_DECK_NAME,
      };
      const snapshot = buildDeckSnapshot(savedDeck);
      setLastSavedDeck(savedDeck);
      setUnsavedState(snapshot, snapshot);
      toast.success(i18n._(msg`Deck deleted`));
      onDeckDeleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : i18n._(msg`Failed to delete deck`));
    } finally {
      setIsDeleting(false);
    }
  }
  /**
   * Unified card-selection handler passed down to DeckListView.
   * Plain click → toggle individual card (others stay selected).
   * Shift+click → select the range from the last-clicked card to this one.
   */
  function handleSelectCard(cardName: string, shiftKey: boolean) {
    if (shiftKey) {
      const orderedNames = new Set<string>();
      for (const c of currentDeck.commanders ?? []) orderedNames.add(c.identity.name);
      for (const s of sectionGroups)
        for (const g of s.groups) orderedNames.add(g.card.identity.name);
      for (const g of otherGroups) orderedNames.add(g.card.identity.name);
      for (const g of sideGroups) orderedNames.add(g.card.identity.name);
      for (const g of maybeGroups) orderedNames.add(g.card.identity.name);
      for (const section of specialSections)
        for (const g of section.groups) orderedNames.add(g.card.identity.name);
      rangeSelect(cardName, [...orderedNames]);
    } else {
      toggleCard(cardName);
    }
  }
  function handleImportReadOnlyDeck() {
    const importedName = currentDeck.name;
    const importedId = importReadOnlyDeck();
    if (!importedId) return;
    onReadOnlyDeckImported?.(importedId);
    toast.success(i18n._(msg`Copied "${importedName}" to My Decks`));
  }
  const editorCommands: DeckEditorCommand[] = [
    {
      id: "save",
      get label() {
        return i18n._(msg`Save deck`);
      },
      keywords: ["persist", "version"],
      disabled: isReadOnly || isSaving,
      disabledReason: isReadOnly ? "Read only" : isSaving ? "Saving" : undefined,
      run: () => void handleSave(),
    },
    {
      id: "import",
      get label() {
        return i18n._(msg`Import a card list`);
      },
      keywords: ["paste", "add cards"],
      disabled: isReadOnly,
      disabledReason: isReadOnly ? "Read only" : undefined,
      run: () => setImportOpen(true),
    },
    {
      id: "undo",
      get label() {
        return i18n._(msg`Undo last deck edit`);
      },
      run: undoDeckEdit,
    },
    {
      id: "redo",
      get label() {
        return i18n._(msg`Redo last deck edit`);
      },
      run: redoDeckEdit,
    },
    {
      id: "view-list",
      get label() {
        return i18n._(msg`Switch to list view`);
      },
      run: () => setViewMode("list"),
    },
    {
      id: "view-grid",
      get label() {
        return i18n._(msg`Switch to grid view`);
      },
      run: () => setViewMode("visual"),
    },
    {
      id: "view-stacks",
      get label() {
        return i18n._(msg`Switch to stack view`);
      },
      run: () => setViewMode("stack"),
    },
    {
      id: "next-editor-section",
      get label() {
        return i18n._(msg`Jump to next editor section`);
      },
      keywords: ["cycle", "scroll", "navigate"],
      run: () => jumpToNextEditorSection(),
    },
    {
      id: "collapse-sections",
      get label() {
        return i18n._(msg`Collapse all deck sections`);
      },
      keywords: ["fold", "close", "hide"],
      run: () => setAllDeckSectionsExpanded(false),
    },
    {
      id: "expand-sections",
      get label() {
        return i18n._(msg`Expand all deck sections`);
      },
      keywords: ["unfold", "open", "show"],
      run: () => setAllDeckSectionsExpanded(true),
    },
    {
      id: "group-type",
      get label() {
        return i18n._(msg`Group cards by type`);
      },
      run: () => setGroupBy("type"),
    },
    {
      id: "group-mana",
      get label() {
        return i18n._(msg`Group cards by mana value`);
      },
      run: () => setGroupBy("cmc"),
    },
    {
      id: "group-color",
      get label() {
        return i18n._(msg`Group cards by color`);
      },
      run: () => setGroupBy("color"),
    },
    {
      id: "group-tags",
      get label() {
        return i18n._(msg`Group cards by custom tags`);
      },
      run: () => setGroupBy("custom"),
    },
    {
      id: "sort-name",
      get label() {
        return i18n._(msg`Sort cards by name`);
      },
      run: () => setSortBy("name"),
    },
    {
      id: "sort-mana",
      get label() {
        return i18n._(msg`Sort cards by mana value`);
      },
      run: () => setSortBy("mana-value"),
    },
    {
      id: "sort-quantity",
      get label() {
        return i18n._(msg`Sort cards by quantity`);
      },
      run: () => setSortBy("quantity"),
    },
    {
      id: "sort-owned",
      get label() {
        return i18n._(msg`Sort owned cards first`);
      },
      run: () => setSortBy("owned"),
    },
    {
      id: "sort-not-owned",
      get label() {
        return i18n._(msg`Sort not owned cards first`);
      },
      run: () => setSortBy("not-owned"),
    },
    {
      id: "view-collection-gaps",
      get label() {
        return i18n._(msg`Show collection gaps`);
      },
      keywords: ["missing", "owned", "filter"],
      run: () => setCollectionFilter("missing"),
    },
    {
      id: "filter-partial-owned",
      get label() {
        return i18n._(msg`Show partially owned cards`);
      },
      keywords: ["collection", "shortage", "filter"],
      run: () => setCollectionFilter("partial"),
    },
    {
      id: "filter-exact-printings",
      get label() {
        return i18n._(msg`Show exact printings owned`);
      },
      keywords: ["collection", "printing", "filter"],
      run: () => setCollectionFilter("exact"),
    },
    {
      id: "editor-tour",
      get label() {
        return i18n._(msg`Open deck editor guide`);
      },
      keywords: ["help", "learn", "what can I do", "onboarding"],
      run: openDeckEditorWelcome,
    },
    {
      id: "clear-filter",
      get label() {
        return i18n._(msg`Clear card filters`);
      },
      keywords: ["show all", "reset search"],
      disabled: !deckFilter && cmcFilter === null,
      disabledReason: !deckFilter && cmcFilter === null ? "No active filters" : undefined,
      run: () => {
        setDeckFilter("");
        setCmcFilter(null);
      },
    },
    {
      id: "select-all",
      get label() {
        return i18n._(msg`Select all cards`);
      },
      keywords: ["bulk", "multi select"],
      disabled: allDeckCards().length === 0,
      disabledReason: allDeckCards().length === 0 ? "Deck is empty" : undefined,
      run: selectAllDeckCards,
    },
    {
      id: "select-filtered",
      get label() {
        return i18n._(msg`Select cards matching current filters`);
      },
      keywords: ["visible", "search", "bulk"],
      disabled: !deckFilter && cmcFilter === null,
      disabledReason: !deckFilter && cmcFilter === null ? "No active filters" : undefined,
      run: () =>
        selectCards(
          currentDeck.cards
            .filter((card) => matchesFilters(card))
            .map((card) => card.identity.name),
          true,
        ),
    },
    {
      id: "select-unsupported",
      get label() {
        return i18n._(msg`Select unsupported cards`);
      },
      keywords: ["engine", "warning", "bulk"],
      disabled: editableUnsupportedNames.size === 0,
      disabledReason:
        editableUnsupportedNames.size === 0
          ? i18n._(msg`No editable unsupported cards`)
          : undefined,
      run: () => selectEditableCards(editableUnsupportedNames),
    },
    ...(currentDeck.customTags ?? []).map(
      (tag): DeckEditorCommand => ({
        id: `select-tag-${tag}`,
        label: i18n._(msg`Select cards tagged ${tag}`),
        keywords: ["group", "role", "bulk"],
        run: () =>
          selectEditableCards(
            Object.entries(currentDeck.cardTags ?? {})
              .filter(([, tags]) => tags.includes(tag))
              .map(([name]) => name),
          ),
      }),
    ),
    {
      id: "toggle-search",
      get label() {
        return i18n._(msg`Toggle card search panel`);
      },
      keywords: ["find", "scryfall"],
      disabled: !onToggleSearch,
      run: () => onToggleSearch?.(),
    },
    {
      id: "toggle-preview",
      get label() {
        return i18n._(msg`Toggle card preview panel`);
      },
      keywords: ["inspector", "details"],
      disabled: !onPreviewCollapsedChange,
      run: () => onPreviewCollapsedChange?.(!(previewCollapsed ?? false)),
    },
    {
      id: "export",
      get label() {
        return i18n._(msg`Copy deck list`);
      },
      keywords: ["export", "clipboard"],
      run: handleExport,
    },
    {
      id: "export-printings",
      get label() {
        return i18n._(msg`Copy deck with exact printings`);
      },
      keywords: ["export", "moxfield", "archidekt", "foil", "sets"],
      run: handleExactExport,
    },
    {
      id: "copy-selection",
      get label() {
        return i18n._(msg`Copy selected cards`);
      },
      keywords: ["clipboard", "duplicate"],
      disabled: selectedCards.size === 0,
      disabledReason: selectedCards.size === 0 ? "No selection" : undefined,
      run: () => void copySelectedCards(),
    },
    {
      id: "paste-cards",
      get label() {
        return i18n._(msg`Paste cards into deck`);
      },
      keywords: ["clipboard", "import"],
      disabled: isReadOnly,
      disabledReason: isReadOnly ? "Read only" : undefined,
      run: () => void pasteCards(),
    },
    {
      id: "labels",
      get label() {
        return i18n._(msg`Manage deck labels`);
      },
      keywords: ["organize", "collection"],
      disabled: isReadOnly,
      disabledReason: isReadOnly ? "Read only" : undefined,
      run: () => setLabelsOpen(true),
    },
    {
      id: "remove-selection",
      get label() {
        return i18n._(msg`Remove selected cards`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: handleRemoveSelected,
    },
    {
      id: "tag-selection",
      get label() {
        return i18n._(msg`Tag selected cards`);
      },
      keywords: ["group", "role", "organize"],
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: () => setTagDialogOpen(true),
    },
    {
      id: "move-selection-main",
      get label() {
        return i18n._(msg`Move selected cards to main deck`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: handleMoveSelectedToMain,
    },
    {
      id: "move-selection-side",
      get label() {
        return i18n._(msg`Move selected cards to sideboard`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: handleMoveSelectedToSide,
    },
    {
      id: "move-selection-maybe",
      get label() {
        return i18n._(msg`Move selected cards to maybeboard`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: handleMoveSelectedToMaybe,
    },
    {
      id: "add-selection-copy",
      get label() {
        return i18n._(msg`Add one copy of each selected card`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: addOneEachSelected,
    },
    {
      id: "remove-selection-copy",
      get label() {
        return i18n._(msg`Remove one copy of each selected card`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: removeOneEachSelected,
    },
    {
      id: "foil-selection",
      get label() {
        return i18n._(msg`Toggle foil for selected cards`);
      },
      disabled: selectedCards.size === 0 || isReadOnly,
      disabledReason: selectedCards.size === 0 ? "No selection" : "Read only",
      run: toggleSelectedFoil,
    },
    {
      id: "manage-tags",
      get label() {
        return i18n._(msg`Manage deck tags`);
      },
      keywords: ["rename", "reorder", "delete", "groups"],
      disabled: isReadOnly,
      disabledReason: isReadOnly ? "Read only" : undefined,
      run: () => setTagManagerOpen(true),
    },
    {
      id: "batch-printings",
      get label() {
        return i18n._(msg`Change deck printings`);
      },
      keywords: ["art", "edition", "set"],
      disabled: isReadOnly,
      disabledReason: isReadOnly ? "Read only" : undefined,
      run: () => {
        setBatchPrintingSelectionOnly(false);
        setBatchPrintingOpen(true);
      },
    },
    {
      id: "optimize-printings",
      get label() {
        return i18n._(msg`Optimize deck printings`);
      },
      keywords: ["owned", "cheapest", "non-foil", "collection", "price"],
      disabled: isReadOnly,
      disabledReason: isReadOnly ? "Read only" : undefined,
      run: () => setPrintingOptimizerOpen(true),
    },
  ];
  return (
    <div className="deck-editor-root flex flex-col h-full w-full relative">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectedCards.size > 0
          ? i18n._(msg`${selectedCards.size} card${selectedCards.size === 1 ? "" : "s"} selected`)
          : i18n._(msg`Selection cleared`)}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        <span key={announcement.id}>{announcement.message}</span>
      </div>
      {isReadOnly && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-2">
          <Bookmark className="h-3.5 w-3.5 text-warning shrink-0" />
          <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-warning">
            {readOnlySource === "hub"
              ? i18n._(msg`Hub snapshot — read only`)
              : i18n._(msg`Starter deck — read only`)}
          </span>
          <span className="hidden min-w-0 flex-1 truncate text-xs text-warning/70 sm:block">
            <Trans>Browse the cards below. Editing is locked.</Trans>
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {hubEnabled && readOnlySource === "preset" && currentDeck.id && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 pointer-coarse:h-10"
                onClick={() => {
                  if (!currentDeck.id) return;
                  navigate(
                    `${ROUTES.HUB}?deck=${encodeURIComponent(currentDeck.id)}&source=presets`,
                  );
                }}
              >
                <Trans>
                  <LibraryBig className="mr-1 h-3.5 w-3.5" />
                  View in Community
                </Trans>
              </Button>
            )}
            <Button
              size="sm"
              className="h-7 pointer-coarse:h-10"
              onClick={handleImportReadOnlyDeck}
            >
              <Trans>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Copy and edit
              </Trans>
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-1 min-h-0">
        <div
          ref={editorScrollRef}
          tabIndex={-1}
          aria-label={i18n._(msg`Deck editor workspace`)}
          className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden"
          onScroll={(event) => setShowBackToTop(event.currentTarget.scrollTop > 120)}
        >
          <DeckHero
            onNameCommit={(name) =>
              void handleSave({ ...useDeckStore.getState().currentDeck, name })
            }
          />

          <div className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b bg-background/85 px-3 py-2 backdrop-blur-md max-sm:flex-nowrap max-sm:overflow-x-auto">
            {!isReadOnly && <DeckHistoryControls />}
            <DeckStatusSummary
              legalityErrors={deckValidation.errors.length}
              unsupportedCards={unsupportedNames.size}
              collectionGaps={collectionGapCount}
              budgetTracked={currentDeck.editor?.budgetAmount !== undefined}
              onNavigate={navigateToDeckStatus}
            />
            <div className="relative shrink-0 w-32">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                ref={filterInputRef}
                className="h-6 text-xs pl-6 pr-6 pointer-coarse:h-9 pointer-coarse:text-base"
                placeholder={i18n._(msg`Filter\u2026`)}
                title={i18n._(
                  msg`Filter by name or use tag:, type:, color:, section:, mv>=, is:owned, is:missing, is:partial, is:foil, is:combo, and - to negate`,
                )}
                value={deckFilter}
                onChange={(e) => setDeckFilter(e.target.value)}
              />
              {deckFilter && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setDeckFilter("")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            {cmcFilter !== null && (
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/25"
                title={i18n._(msg`Clear mana value filter`)}
                onClick={() => setCmcFilter(null)}
              >
                <Trans>
                  {CMC_BUCKET_LABELS[cmcFilter]} mana
                  <X className="h-3 w-3" />
                </Trans>
              </button>
            )}
            {collectionFilter !== "all" && (
              <button
                type="button"
                className="flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium capitalize text-primary transition-colors hover:bg-primary/25"
                title={i18n._(msg`Clear collection filter`)}
                onClick={() => setCollectionFilter("all")}
              >
                <Trans>
                  Collection: {collectionFilter.replace("-", " ")}
                  <X className="h-3 w-3" />
                </Trans>
              </button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md border shrink-0 transition-colors">
                  <Group className="h-3 w-3" />
                  <span>{GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}</span>
                  <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {GROUP_BY_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onSelect={() => setGroupBy(opt.value)}
                    className={cn(groupBy === opt.value && "bg-muted font-medium")}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                  <span>
                    <Trans>
                      Sort: {SORT_OPTIONS.find((option) => option.value === sortBy)?.label}
                    </Trans>
                  </span>
                  <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {SORT_OPTIONS.map((option) => (
                  <DropdownMenuItem
                    key={option.value}
                    onSelect={() => setSortBy(option.value)}
                    className={cn(sortBy === option.value && "bg-muted font-medium")}
                  >
                    {option.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DeckLayoutMenu
              compact
              groupBy={groupBy}
              sortBy={sortBy}
              cardSize={cardSize}
              filter={deckFilter}
              viewMode={viewMode}
              collectionFilter={collectionFilter}
              onApply={(
                nextGroupBy,
                nextSortBy,
                nextCardSize,
                nextFilter,
                nextViewMode,
                nextCollectionFilter,
              ) => {
                setGroupBy(nextGroupBy);
                setSortBy(nextSortBy);
                setCardSize(nextCardSize);
                setDeckFilter(nextFilter);
                setViewMode(nextViewMode);
                setCollectionFilter(nextCollectionFilter);
              }}
            />
            <div className="flex rounded-md border overflow-hidden shrink-0">
              {(
                [
                  ["list", List],
                  ["visual", LayoutGrid],
                  ["stack", Layers],
                ] as const
              ).map(([mode, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  title={mode.charAt(0).toUpperCase() + mode.slice(1)}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    "p-1 transition-colors border-r last:border-r-0",
                    viewMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-3 w-3" />
                </button>
              ))}
            </div>
            {viewMode !== "list" && (
              <input
                type="range"
                min={1}
                max={MAX_CARD_SIZE}
                step={1}
                value={cardSize}
                onChange={(e) => setCardSize(Number(e.target.value))}
                className="w-32 h-1 cursor-pointer accent-primary shrink-0"
                title={i18n._(msg`Card size: ${cardSize}`)}
              />
            )}
            <div className="flex-1 min-w-40">
              <DeckQuickAdd
                customTags={currentDeck.customTags ?? []}
                getCount={(name) =>
                  currentDeck.cards.filter((card) => card.identity.name === frontFaceName(name))
                    .length
                }
                onAdd={(sc, request) => {
                  const card = scryfallToDeckCard(sc);
                  const format = getFormat(currentDeck.format ?? "standard");
                  const existingCount = currentDeck.cards.filter(
                    (candidate) => candidate.identity.name === card.identity.name,
                  ).length;
                  const copyLimit =
                    request.destination === "main" &&
                    !allowIllegalDecks &&
                    !canHaveAnyNumberOf(card)
                      ? (copyLimitFromText(card.text) ?? format?.deckRules.maxCopies)
                      : undefined;
                  const quantity = copyLimit
                    ? Math.min(request.quantity, Math.max(0, copyLimit - existingCount))
                    : request.quantity;
                  if (quantity === 0) {
                    const formatName =
                      format?.name ?? currentDeck.format ?? i18n._(msg`this format`);
                    toast.error(
                      i18n._(
                        msg`Max ${copyLimit ?? 0} copies of "${sc.name}" allowed in ${formatName}`,
                      ),
                    );
                    return false;
                  }
                  executeDeckEdit(
                    i18n._(msg`Add ${quantity} ${sc.name} to ${request.destination}`),
                    () => {
                      for (let index = 0; index < quantity; index += 1) {
                        const copy = {
                          ...card,
                          identity: { ...card.identity, id: crypto.randomUUID() },
                        };
                        if (request.destination === "side") addToSide(copy);
                        else if (request.destination === "maybe") addToMaybe(copy);
                        else addToMain(copy);
                      }
                      for (const tag of request.tags) {
                        addCustomTag(tag);
                        tagCard(card.identity.name, tag);
                      }
                    },
                  );
                  if (quantity < request.quantity) {
                    const formatName =
                      format?.name ?? currentDeck.format ?? i18n._(msg`this format`);
                    toast.warning(
                      i18n._(
                        msg`Added ${quantity} of ${request.quantity} ${sc.name}; ${formatName} allows ${copyLimit ?? 0}`,
                      ),
                    );
                  } else {
                    const destination =
                      request.destination === "side"
                        ? i18n._(msg`sideboard`)
                        : request.destination === "maybe"
                          ? i18n._(msg`maybeboard`)
                          : i18n._(msg`main deck`);
                    toast.success(i18n._(msg`Added ${quantity} ${sc.name} to ${destination}`));
                  }
                  return true;
                }}
              />
            </div>
            {!isReadOnly && (
              <span className="shrink-0 text-[11px] text-muted-foreground" aria-live="polite">
                {isSaving || syncState === "saving"
                  ? i18n._(msg`Saving\u2026`)
                  : hasUnsavedChanges
                    ? i18n._(msg`Unsaved`)
                    : syncState === "local"
                      ? i18n._(msg`Saved locally`)
                      : syncState === "synced"
                        ? i18n._(msg`Synced`)
                        : syncState === "failed"
                          ? i18n._(msg`Sync failed`)
                          : i18n._(msg`Saved`)}
              </span>
            )}

            {!isReadOnly && (
              <DeckChangeSummary currentDeck={currentDeck} savedDeck={lastSavedDeck} />
            )}

            {isReadOnly ? (
              <Button
                size="sm"
                variant="ghost"
                disabled
                className="h-7 shrink-0 gap-1 text-xs text-muted-foreground/60"
                title={i18n._(msg`Make an editable copy to enable saving`)}
              >
                <Trans>
                  <Save className="h-3.5 w-3.5" />
                  Save
                </Trans>
              </Button>
            ) : (
              <Button
                size="sm"
                variant={
                  isDeckLegal
                    ? hasUnsavedChanges || currentDeck.draft
                      ? "default"
                      : "secondary"
                    : "outline"
                }
                disabled={isSaving || (!hasUnsavedChanges && !currentDeck.draft)}
                className={cn(
                  "h-7 shrink-0 gap-1 text-xs",
                  !isDeckLegal && "border-warning/50 text-warning hover:bg-warning/10",
                )}
                title={
                  hasUnsupportedCards
                    ? unsupportedNames.size === 1
                      ? i18n._(msg`One card is unsupported by the Manabrew and Forge engines`)
                      : i18n._(
                          msg`${unsupportedNames.size} cards are unsupported by the Manabrew and Forge engines`,
                        )
                    : !isDeckLegal
                      ? i18n._(
                          msg`${deckValidation.errors[0] ?? i18n._(msg`Deck is not legal in this format`)} — saves with a warning`,
                        )
                      : hasUnsavedChanges
                        ? i18n._(msg`Save deck (unsaved changes)`)
                        : currentDeck.draft
                          ? i18n._(msg`Save draft as a full deck`)
                          : i18n._(msg`Deck saved`)
                }
                onClick={() => void handleSave()}
              >
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {isSaving ? i18n._(msg`Saving`) : i18n._(msg`Save`)}
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  disabled={isReadOnly}
                  aria-label={i18n._(msg`Deck actions`)}
                >
                  <EllipsisVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setCommandPaletteOpen(true)}>
                  <Trans>
                    <CommandIcon className="mr-2 h-3.5 w-3.5" /> Command palette
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={openDeckEditorWelcome}>
                  <Trans>
                    <BookOpen className="mr-2 h-3.5 w-3.5" /> Deck editor guide
                  </Trans>
                </DropdownMenuItem>
                {onToggleSearch && (
                  <DropdownMenuItem onSelect={onToggleSearch}>
                    <Trans>
                      <Search className="mr-2 h-3.5 w-3.5" /> Card search
                    </Trans>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => setAllDeckSectionsExpanded(false)}>
                  <Trans>
                    <FoldVertical className="mr-2 h-3.5 w-3.5" /> Collapse all sections
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAllDeckSectionsExpanded(true)}>
                  <Trans>
                    <UnfoldVertical className="mr-2 h-3.5 w-3.5" /> Expand all sections
                  </Trans>
                </DropdownMenuItem>
                <div className="my-1 border-t" />
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                  <Trans>
                    <ListPlus className="mr-2 h-3.5 w-3.5" /> Import list
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={handleExport}
                  disabled={currentDeck.cards.length === 0 && !currentDeck.commanders?.length}
                >
                  <Trans>
                    <ClipboardCopy className="h-3.5 w-3.5 mr-2" /> Export to clipboard
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleExactExport}>
                  <Trans>
                    <Images className="mr-2 h-3.5 w-3.5" /> Export exact printings
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setBatchPrintingSelectionOnly(false);
                    setBatchPrintingOpen(true);
                  }}
                >
                  <Trans>
                    <Images className="mr-2 h-3.5 w-3.5" /> Change deck printings
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPrintingOptimizerOpen(true)}>
                  <Trans>
                    <Sparkles className="mr-2 h-3.5 w-3.5" /> Optimize deck printings
                  </Trans>
                </DropdownMenuItem>
                {publishEnabled && (
                  <DropdownMenuItem
                    onSelect={() => setPublishOpen(true)}
                    disabled={currentDeck.cards.length === 0 && !currentDeck.commanders?.length}
                  >
                    <Trans>
                      <Share2 className="h-3.5 w-3.5 mr-2" /> Publish to Community
                    </Trans>
                  </DropdownMenuItem>
                )}
                {accountsEnabled &&
                  accountSavedDeck?.accountDeckId &&
                  accountSavedDeck.accountVersionNo && (
                    <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                      <Trans>
                        <History className="mr-2 h-3.5 w-3.5" /> Version history
                      </Trans>
                    </DropdownMenuItem>
                  )}
                <DropdownMenuItem onSelect={handleSaveDraft}>
                  <Trans>
                    <FileBox className="h-3.5 w-3.5 mr-2" /> Save as draft
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCheckpointsOpen(true)}>
                  <Trans>
                    <History className="mr-2 h-3.5 w-3.5" /> Local checkpoints
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setSideboardPlansOpen(true)}>
                  <Trans>
                    <ListPlus className="mr-2 h-3.5 w-3.5" /> Sideboard plans
                  </Trans>
                </DropdownMenuItem>
                <div className="border-t my-1" />
                <DropdownMenuItem onSelect={() => setLabelsOpen(true)}>
                  <Trans>
                    <Palette className="h-3.5 w-3.5 mr-2" /> Deck labels
                    {(currentDeck.labels?.length ?? 0) > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {currentDeck.labels!.length}
                      </span>
                    )}
                  </Trans>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  <Trans>
                    <Bookmark className="h-3.5 w-3.5 mr-2" /> Tags
                    {(currentDeck.customTags?.length ?? 0) > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {currentDeck.customTags!.length}
                      </span>
                    )}
                  </Trans>
                </DropdownMenuItem>
                {(currentDeck.customTags ?? []).length > 0 && (
                  <>
                    {(currentDeck.customTags ?? []).map((tag) => (
                      <DropdownMenuItem
                        key={tag}
                        className="text-xs pl-8 justify-between"
                        onSelect={(e) => e.preventDefault()}
                      >
                        <span>{tag}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-destructive shrink-0"
                          onClick={() => {
                            executeDeckEdit(i18n._(msg`Remove ${tag} tag`), () =>
                              removeCustomTag(tag),
                            );
                            toast.success(i18n._(msg`Tag "${tag}" removed`));
                          }}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <div className="px-2 py-1.5">
                  <Input
                    className="h-7 text-xs"
                    placeholder={i18n._(msg`New tag\u2026`)}
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter" && newTagInput.trim()) {
                        executeDeckEdit(i18n._(msg`Create ${newTagInput.trim()} tag`), () =>
                          addCustomTag(newTagInput.trim()),
                        );
                        toast.success(i18n._(msg`Tag "${newTagInput.trim()}" added`));
                        setNewTagInput("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="border-t my-1" />
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => setConfirmClear(true)}
                >
                  <Trans>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete deck
                  </Trans>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <CardCollectionOwnershipScope
            disabled={isReadOnly}
            quantities={collectionQuantities}
            deckOwnership={ownershipByName}
          >
            <div className={cn(isReadOnly && "opacity-60 bg-muted/15")}>
              <div data-editor-section="build" className="scroll-mt-12">
                <DeckValidationPanel unsupportedNames={unsupportedNames} />
                <CommanderSlots
                  key={`command-zone-${editorSessionId}`}
                  cards={currentDeck.cards}
                  commanders={currentDeck.commanders ?? []}
                  format={currentDeck.format ?? "standard"}
                  cardSize={cardSize}
                  readOnly={isReadOnly}
                  onSetCommander={handleSetCommander}
                  onRemoveCommander={handleRemoveCommander}
                  onHover={(card, event) =>
                    preview.handleMouseEnter(deckCardToPreviewDto(card), event, {
                      useDelay: true,
                    })
                  }
                  onLeave={preview.handleMouseLeave}
                  onPickPrint={setPrintPickerCard}
                  contextMenuFor={(card, label) => {
                    const name = card.identity.name;
                    const isCover =
                      currentDeck.coverCardName === name && (currentDeck.coverCardFace ?? 0) === 0;
                    const isCoverBack =
                      currentDeck.coverCardName === name && currentDeck.coverCardFace === 1;
                    return {
                      commanderLabel: label,
                      customTags: currentDeck.customTags ?? [],
                      appliedTags: currentDeck.cardTags?.[name.toLowerCase()] ?? [],
                      isFoil: !!card.identity.foil,
                      isCover,
                      isCoverBack,
                      hasBackFace: !!card.backFace,
                      onShowInfo: () => handleShowInfo(card),
                      onRemoveCommander: () => handleRemoveCommander(card),
                      onPickPrint: () => setPrintPickerCard(card),
                      onToggleFoil: () =>
                        executeDeckEdit(i18n._(msg`Toggle foil for ${name}`), () =>
                          toggleFoil(name),
                        ),
                      onSetCover: () => {
                        executeDeckEdit(i18n._(msg`Change deck cover`), () =>
                          setCoverCard(isCover ? undefined : name, 0),
                        );
                        if (!isCover) useScryfallStore.getState().invalidateCard(name);
                      },
                      onSetCoverBack: () => {
                        executeDeckEdit(i18n._(msg`Change deck cover`), () =>
                          setCoverCard(isCoverBack ? undefined : name, 1),
                        );
                        if (!isCoverBack) useScryfallStore.getState().invalidateCard(name);
                      },
                      onApplyTag: (tag) => {
                        const isApplied = currentDeck.cardTags?.[name.toLowerCase()]?.includes(tag);
                        executeDeckEdit(
                          isApplied ? i18n._(msg`Remove ${tag}`) : i18n._(msg`Apply ${tag}`),
                          () => {
                            if (isApplied) untagCard(name, tag);
                            else tagCard(name, tag);
                          },
                        );
                      },
                      onCreateTag: (tag) =>
                        executeDeckEdit(i18n._(msg`Create ${tag} tag`), () => {
                          addCustomTag(tag);
                          tagCard(name, tag);
                        }),
                    };
                  }}
                />
                <div
                  ref={setMainDropRef}
                  className={cn("transition-colors", isOverMain && !isOverSide && "bg-primary/5")}
                >
                  <DeckListView
                    key={`deck-sections-${editorSessionId}`}
                    viewMode={viewMode}
                    cardSize={cardSize}
                    commanders={currentDeck.commanders ?? []}
                    deckFormat={currentDeck.format ?? "standard"}
                    mainSections={sectionGroups}
                    otherGroups={otherGroups}
                    sideboardGroups={sideGroups}
                    maybeboardGroups={maybeGroups}
                    specialSections={specialSections}
                    stackColumns={stackColsData}
                    isOverSide={isOverSide}
                    setSideDropRef={setSideDropRef}
                    isOverMaybe={isOverMaybe}
                    setMaybeDropRef={setMaybeDropRef}
                    onAddOne={handleAddOneToMain}
                    onRemoveOne={handleRemoveOneFromMain}
                    onRemoveAll={handleRemoveAllFromMain}
                    onSetCommander={handleSetCommander}
                    onRemoveCommander={handleRemoveCommander}
                    onMoveOneToSide={handleMoveOneToSide}
                    onMoveAllToSide={handleMoveAllToSide}
                    onMoveOneToMaybe={handleMoveOneToMaybe}
                    onMoveAllToMaybe={handleMoveAllToMaybe}
                    onMoveOneFromSideToMain={handleMoveOneFromSideToMain}
                    onMoveAllFromSideToMain={handleMoveAllFromSideToMain}
                    onMoveOneFromSideToMaybe={handleMoveOneFromSideToMaybe}
                    onMoveAllFromSideToMaybe={handleMoveAllFromSideToMaybe}
                    onMoveOneFromMaybeToMain={handleMoveOneFromMaybeToMain}
                    onMoveAllFromMaybeToMain={handleMoveAllFromMaybeToMain}
                    onMoveOneFromMaybeToSide={handleMoveOneFromMaybeToSide}
                    onMoveAllFromMaybeToSide={handleMoveAllFromMaybeToSide}
                    onPickPrint={setPrintPickerCard}
                    onToggleFoil={(name) =>
                      executeDeckEdit(i18n._(msg`Toggle foil for ${name}`), () => toggleFoil(name))
                    }
                    onHover={(card, e) =>
                      preview.handleMouseEnter(deckCardToPreviewDto(card), e, { useDelay: true })
                    }
                    onLeave={preview.handleMouseLeave}
                    onAddToSide={(card) =>
                      executeDeckEdit(i18n._(msg`Add ${card.identity.name} to sideboard`), () =>
                        addToSide(card),
                      )
                    }
                    onRemoveFromSide={handleRemoveOneFromSide}
                    onAddToMaybe={(card) =>
                      executeDeckEdit(i18n._(msg`Add ${card.identity.name} to maybeboard`), () =>
                        addToMaybe(card),
                      )
                    }
                    onRemoveFromMaybe={handleRemoveOneFromMaybe}
                    totalCards={currentDeck.cards.length + (currentDeck.commanders?.length ?? 0)}
                    customTags={currentDeck.customTags}
                    cardTags={currentDeck.cardTags}
                    allMainCards={currentDeck.cards}
                    onUntagCard={(name, tag) =>
                      executeDeckEdit(i18n._(msg`Remove ${tag} from ${name}`), () =>
                        untagCard(name, tag),
                      )
                    }
                    onTagCard={(name, tag) =>
                      executeDeckEdit(i18n._(msg`Tag ${name} with ${tag}`), () =>
                        tagCard(name, tag),
                      )
                    }
                    onAddCustomTag={(tag) =>
                      executeDeckEdit(i18n._(msg`Create ${tag} tag`), () => addCustomTag(tag))
                    }
                    onRemoveTag={(tag) =>
                      executeDeckEdit(i18n._(msg`Remove ${tag} tag`), () => removeCustomTag(tag))
                    }
                    selectedCards={selectedCards}
                    onSelectCard={handleSelectCard}
                    onSelectAll={(names) => selectCards(names, true)}
                    onShowInfo={handleShowInfo}
                    coverCardName={currentDeck.coverCardName}
                    coverCardFace={currentDeck.coverCardFace}
                    onSetCover={(card) => {
                      const isSameFront =
                        currentDeck.coverCardName === card.identity.name &&
                        (currentDeck.coverCardFace ?? 0) === 0;
                      executeDeckEdit(`Change deck cover`, () =>
                        setCoverCard(isSameFront ? undefined : card.identity.name, 0),
                      );
                      if (!isSameFront)
                        useScryfallStore.getState().invalidateCard(card.identity.name);
                    }}
                    onSetCoverBack={(card) => {
                      const isSameBack =
                        currentDeck.coverCardName === card.identity.name &&
                        currentDeck.coverCardFace === 1;
                      executeDeckEdit(`Change deck cover`, () =>
                        setCoverCard(isSameBack ? undefined : card.identity.name, 1),
                      );
                      if (!isSameBack)
                        useScryfallStore.getState().invalidateCard(card.identity.name);
                    }}
                    stackPositions={currentDeck.stackPositions}
                    onStackPositionsChange={setStackPositions}
                  />
                </div>
              </div>

              <div data-editor-section="analysis" className="scroll-mt-12 px-4 pb-10 pt-4">
                <button
                  type="button"
                  className="mb-4 flex w-full items-center gap-3 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={analysisOpen}
                  onClick={() => setAnalysisOpen((value) => !value)}
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      !analysisOpen && "-rotate-90",
                    )}
                  />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <Trans>Deck Analysis</Trans>
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </button>
                {analysisOpen && (
                  <div className="space-y-5">
                    {mergedTokens.length > 0 && (
                      <TokenSection
                        key={`tokens-${editorSessionId}`}
                        tokens={mergedTokens}
                        customizedTokens={currentDeck.tokens}
                        cardSize={cardSize}
                        onShowInfo={handleShowTokenInfo}
                        onPickPrint={setTokenPrintPicker}
                        onResetPrint={(token) =>
                          executeDeckEdit(`Reset ${token.identity.name} token printing`, () =>
                            resetTokenPrint(token),
                          )
                        }
                        onHover={(token, e) =>
                          preview.handleMouseEnter(deckCardToPreviewDto(token), e, {
                            useDelay: true,
                          })
                        }
                        onLeave={preview.handleMouseLeave}
                      />
                    )}
                    <DeckInsightsPanel
                      key={`insights-${editorSessionId}`}
                      deck={currentDeck}
                      unsupportedNames={unsupportedNames}
                      validationErrors={deckValidation.errors}
                      activeBucket={cmcFilter}
                      onBucketClick={setCmcFilter}
                      onShowUnsupported={() => setDeckFilter("is:unsupported")}
                      onOpenSearch={onToggleSearch}
                      cardSize={cardSize}
                      onCardHover={(card, event) =>
                        preview.handleMouseEnter(deckCardToPreviewDto(card), event, {
                          useDelay: true,
                        })
                      }
                      onCardLeave={preview.handleMouseLeave}
                      onOptimizeOwnedPrintings={() => setPrintingOptimizerOpen(true)}
                    />
                    <CombosPanel />
                    <DeckBracketPanel />
                  </div>
                )}
              </div>
            </div>
          </CardCollectionOwnershipScope>
        </div>

        <DeckCheckpointsDialog
          open={checkpointsOpen}
          onOpenChange={setCheckpointsOpen}
          deck={currentDeck}
          deckKey={currentDeckId ?? currentDeck.name.toLowerCase()}
          onRestore={(deck, checkpointName) => {
            executeDeckEdit(`Restore ${checkpointName}`, () =>
              useDeckStore.setState({ currentDeck: deck }),
            );
            setCheckpointsOpen(false);
            toast.success(i18n._(msg`Restored "${checkpointName}"`));
          }}
        />
        <SideboardPlansDialog open={sideboardPlansOpen} onOpenChange={setSideboardPlansOpen} />
        {setPreviewSlot && onPreviewCollapsedChange && (
          <div className="hidden lg:contents">
            <CardPreviewRail
              preview={preview}
              onSlotChange={setPreviewSlot}
              collapsed={previewCollapsed ?? false}
              onCollapsedChange={onPreviewCollapsedChange}
              renderDetails={(card) => <PreviewCardInfo card={card} />}
            />
          </div>
        )}
      </div>

      {showBackToTop && (
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={cn(
            "absolute bottom-4 right-4 z-50 h-10 w-10 rounded-full border shadow-lg",
            selectedCards.size > 0 && "bottom-20",
          )}
          title={i18n._(msg`Back to top`)}
          aria-label={i18n._(msg`Back to top`)}
          onClick={() => editorScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
      )}

      <fieldset disabled={isReadOnly} className="contents">
        {selectedCards.size > 0 && (
          <DeckSelectionTray
            count={selectedCards.size}
            tags={currentDeck.customTags ?? []}
            appliedTags={selectedCardTags}
            onMoveToMain={handleMoveSelectedToMain}
            onMoveToSide={handleMoveSelectedToSide}
            onMoveToMaybe={handleMoveSelectedToMaybe}
            onAddCopy={addOneEachSelected}
            onRemoveCopy={removeOneEachSelected}
            onToggleFoil={toggleSelectedFoil}
            onCopy={() => void copySelectedCards()}
            onTag={handleTagSelected}
            onUntag={handleUntagSelected}
            onPrinting={() => {
              setBatchPrintingSelectionOnly(true);
              setBatchPrintingOpen(true);
            }}
            onRemove={handleRemoveSelected}
            onClear={() => {
              clearSelection();
              window.setTimeout(() => editorScrollRef.current?.focus({ preventScroll: true }));
            }}
          />
        )}

        <PrintPickerModal
          cardName={printPickerCard?.identity.name ?? null}
          onClose={() => setPrintPickerCard(null)}
          onSelect={(print) => {
            if (printPickerCard) {
              executeDeckEdit(`Change ${printPickerCard.identity.name} printing`, () =>
                updatePrintingVariant(printPickerCard.identity, print),
              );
            }
          }}
        />
        <PrintPickerModal
          cardName={tokenPrintPicker?.identity.name ?? null}
          token={tokenPrintPicker ?? undefined}
          onClose={() => setTokenPrintPicker(null)}
          onSelect={(sc) => {
            if (tokenPrintPicker) {
              executeDeckEdit(`Change ${tokenPrintPicker.identity.name} token printing`, () =>
                updateTokenPrint(tokenPrintPicker, sc),
              );
            }
          }}
        />
        {detailCard && (
          <CardDetailModal
            card={detailCard}
            readOnly={isReadOnly}
            onClose={() => {
              setDetailCard(null);
              setDetailToken(null);
              setDetailPrinting(null);
            }}
            deckEditorActions={{
              printing: detailPrinting ?? undefined,
              onAddOne: handleAddOneToMainByName,
              onRemoveOne: handleRemoveOneFromMain,
              onPickPrint: (name) => {
                const card = allDeckCards().find((candidate) => candidate.identity.name === name);
                if (card) setPrintPickerCard(card);
              },
              onSetCommander: (name) => {
                const existing = currentDeck.commanders?.find((c) => c.identity.name === name);
                if (existing) {
                  handleRemoveCommander(existing);
                } else {
                  const card = currentDeck.cards.find((c) => c.identity.name === name);
                  if (card) handleSetCommander(card);
                }
              },
              isCommander:
                currentDeck.commanders?.some(
                  (c) => c.identity.name === frontFaceName(detailCard.name),
                ) ?? false,
              commanderSlot: commanderSlotFor(
                [...currentDeck.cards, ...(currentDeck.commanders ?? [])].find(
                  (c) => c.identity.name === frontFaceName(detailCard.name),
                ),
                currentDeck.format,
              ),
              deckFormat: currentDeck.format ?? "standard",
              customTags: currentDeck.customTags,
              onTagCard: (name, tag) =>
                executeDeckEdit(`Tag ${name} with ${tag}`, () => tagCard(name, tag)),
              onUntagCard: (name, tag) =>
                executeDeckEdit(`Remove ${tag} from ${name}`, () => untagCard(name, tag)),
              onAddTag: (tag) => executeDeckEdit(`Create ${tag} tag`, () => addCustomTag(tag)),
              onToggleFoil: (name) =>
                executeDeckEdit(`Toggle foil for ${name}`, () => toggleFoil(name)),
              onSetCover: (name, face) => {
                const isCurrent =
                  currentDeck.coverCardName === name && (currentDeck.coverCardFace ?? 0) === face;
                executeDeckEdit(`Change deck cover`, () =>
                  setCoverCard(isCurrent ? undefined : name, face),
                );
              },
              token: detailToken ?? undefined,
              onUpdateTokenPrint: (_name, print) => {
                if (detailToken) {
                  executeDeckEdit(`Change ${detailToken.identity.name} token printing`, () =>
                    updateTokenPrint(detailToken, print),
                  );
                }
              },
            }}
          />
        )}
        <DeckLabelsModal open={labelsOpen} onClose={() => setLabelsOpen(false)} />
        <ImportDeckTextDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          mode="add"
          onImport={importIntoCurrentDeck}
        />
        <DeckCommandPalette
          open={commandPaletteOpen}
          onOpenChange={setCommandPaletteOpen}
          commands={editorCommands}
        />
        <DeckTagDialog
          open={tagDialogOpen}
          onOpenChange={setTagDialogOpen}
          tags={currentDeck.customTags ?? []}
          selectedCount={selectedCards.size}
          onApply={handleTagSelected}
          onCreateAndApply={handleCreateAndTagSelected}
        />
        <DeckTagManagerDialog open={tagManagerOpen} onOpenChange={setTagManagerOpen} />
        <BatchPrintingDialog
          open={batchPrintingOpen}
          onOpenChange={setBatchPrintingOpen}
          cardNames={batchPrintingSelectionOnly ? selectedCards : undefined}
        />
        <PrintingOptimizerDialog
          open={printingOptimizerOpen}
          onOpenChange={setPrintingOptimizerOpen}
        />
        {publishEnabled && resumedPublication ? (
          <PublishDeckDialog
            open
            onOpenChange={(open) => {
              if (!open) onResumedPublicationClose?.();
            }}
            deck={resumedPublication.deck}
            localDeckId={resumedPublication.localDeckId}
            resumeInEditor
          />
        ) : publishEnabled ? (
          <PublishDeckDialog
            open={publishOpen}
            onOpenChange={setPublishOpen}
            deck={currentDeck}
            localDeckId={currentDeckId}
            resumeInEditor
          />
        ) : null}
        {accountsEnabled &&
          accountSavedDeck?.accountDeckId &&
          accountSavedDeck.accountVersionNo && (
            <DeckVersionHistoryDialog
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              deckId={accountSavedDeck.accountDeckId}
              currentVersionNo={accountSavedDeck.accountVersionNo}
              hasUnsavedChanges={hasUnsavedChanges}
              onRestore={(deck, versionNo) => {
                useDeckStore.getState().loadDeck(deck);
                resetDeckHistory();
                toast.info(i18n._(msg`Version ${versionNo} loaded. Save to create a new version.`));
              }}
            />
          )}
        <DeckSaveConflictDialog
          conflict={saveConflict}
          busy={isSaving}
          onKeepMine={() => void resolveSaveConflict("mine")}
          onUseAccount={() => void resolveSaveConflict("account")}
          onSaveCopy={() => void resolveSaveConflict("copy")}
          onCancel={() => {
            setSaveConflict(null);
            conflictDeckRef.current = null;
            setSyncState("failed");
          }}
        />

        {confirmClear && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/50 backdrop-blur-sm">
            <div className="bg-card border rounded-xl shadow-xl p-6 max-w-sm space-y-4">
              <h3 className="text-lg font-semibold">
                <Trans>Clear Deck</Trans>
              </h3>
              <p className="text-sm text-muted-foreground">
                <Trans>
                  Are you sure you want to clear &quot;{currentDeck.name}&quot;? This will remove
                  all cards and delete the saved deck.
                </Trans>
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDeleting}
                  onClick={() => setConfirmClear(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting}
                  onClick={() => void handleDeleteCurrentDeck()}
                >
                  {isDeleting ? i18n._(msg`Deleting\u2026`) : i18n._(msg`Delete`)}
                </Button>
              </div>
            </div>
          </div>
        )}
      </fieldset>
      <DeckEditorWelcome readOnly={isReadOnly} />
    </div>
  );
}
