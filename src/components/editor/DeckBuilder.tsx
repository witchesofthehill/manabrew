import { useDeckStore } from "@/stores/useDeckStore";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  X,
  Save,
  Trash2,
  Check,
  Search,
  LayoutGrid,
  List,
  Layers,
  Plus,
  Minus,
  Loader2,
  ChevronDown,
  FileBox,
  ClipboardCopy,
  Palette,
  Bookmark,
  BookmarkMinus,
  Group,
  ArrowUpToLine,
  ArrowDownToLine,
  EllipsisVertical,
  ArrowLeft,
} from "lucide-react";
import { ScryfallImg } from "@/components/ScryfallImg";
import { DeckStats } from "./DeckStats";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import type { DeckCard, DeckFormatId, GameCard } from "@/types/manabrew";
import { fetchCardCollection, searchCards } from "@/api/scryfall";
import type { ScryfallCard } from "@/types/scryfall";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { DROP_ZONE, DEFAULT_DECK_NAME } from "@/lib/constants";
import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import {
  getFormat,
  validateDeckSections,
  BASIC_LAND_NAMES,
  isCommanderEligible,
  canBePartners,
  hasPartner,
  getPartnerWithName,
  GAME_FORMATS,
  copyLimitFromText,
} from "@/lib/formats";
import { FormatBadge } from "@/components/game/FormatBadge";
import { DeckListView } from "./DeckListView";
import { PreviewRail } from "./PreviewRail";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { useCardPreview } from "@/hooks/useCardPreview";
import { CardDetailModal } from "./CardDetailModal";
import { DeckLabelsModal } from "./DeckLabelsModal";
import { DeckLabelBadge } from "@/components/deck/DeckLabelBadge";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { DeckValidationPanel } from "./DeckValidationPanel";
import { useDeckSelection } from "./useDeckSelection";
import {
  type CardGroup,
  type ViewMode,
  type GroupByMode,
  GROUP_BY_OPTIONS,
  groupCards,
  exportToArena,
  computeGroupedSections,
  computeGroupedStackColumns,
} from "./deckBuilder.utils";
import { TokenSection } from "./TokenSection";
import { useDerivedTokens, mergeDerivedAndCustomized } from "@/hooks/useDerivedTokens";

import {
  buildDeckSnapshot,
  setUnsavedState,
  setLastSavedSnapshotRef,
} from "./deckBuilder.unsavedChanges";
import { useScryfallStore } from "@/stores/useScryfallStore";
import { useUnsupportedCards } from "@/hooks/useUnsupportedCards";

// ─── Quick Search ─────────────────────────────────────────────────────────────

function QuickCardSearch({
  onAdd,
  onRemove,
  getCount,
}: {
  onAdd: (card: ScryfallCard) => void;
  onRemove: (cardName: string) => void;
  getCount: (cardName: string) => number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScryfallCard[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback((q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setIsLoading(true);
    const fullQuery = `${q} -is:digital -is:funny`;
    searchCards(fullQuery, 1)
      .then((res) => {
        setResults(res.data.slice(0, 20));
        setIsOpen(true);
      })
      .catch(() => setResults([]))
      .finally(() => setIsLoading(false));
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => doSearch(value), 400);
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Plus className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <Input
          className="h-7 text-xs pl-6 pr-6"
          placeholder="Quick add card…"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
        />
        {isLoading && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin text-muted-foreground" />
        )}
        {!isLoading && query && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQuery("");
              setResults([]);
              setIsOpen(false);
            }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg max-h-80 overflow-y-auto min-w-[280px]">
          {results.map((sc) => {
            const count = getCount(sc.name);
            const thumb = sc.image_uris?.small ?? sc.card_faces?.[0]?.image_uris?.small;
            return (
              <div
                key={sc.id}
                className="flex items-center gap-2 px-2 py-1 hover:bg-muted border-b border-border/30 last:border-0 cursor-pointer"
                onClick={() => onAdd(sc)}
                title={`Add ${sc.name}`}
              >
                {thumb && (
                  <ScryfallImg
                    src={thumb}
                    alt=""
                    className="w-8 h-11 rounded object-cover object-top shrink-0"
                  />
                )}
                <span className="text-xs font-medium flex-1 min-w-0 truncate">{sc.name}</span>
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    className="h-6 w-6 rounded hover:bg-background flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                    title="Remove one"
                    disabled={count === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(sc.name);
                    }}
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span
                    className={cn(
                      "text-xs font-mono w-4 text-center tabular-nums",
                      count > 0 ? "text-foreground" : "text-muted-foreground/40",
                    )}
                  >
                    {count}
                  </span>
                  <button
                    type="button"
                    className="h-6 w-6 rounded hover:bg-background flex items-center justify-center text-muted-foreground hover:text-primary transition-colors"
                    title="Add one"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd(sc);
                    }}
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main DeckBuilder Component ───────────────────────────────────────────────

export function DeckBuilder({
  onToggleSearch,
  onBack,
  previewSlot,
  setPreviewSlot,
  previewCollapsed,
  onTogglePreview,
}: {
  onToggleSearch?: () => void;
  onBack?: () => void;
  previewSlot?: HTMLElement | null;
  setPreviewSlot?: (el: HTMLDivElement | null) => void;
  previewCollapsed?: boolean;
  onTogglePreview?: () => void;
} = {}) {
  const [printPickerCard, setPrintPickerCard] = useState<string | null>(null);
  const [tokenPrintPickerName, setTokenPrintPickerName] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<ScryfallCard | null>(null);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const isReadOnly = useDeckStore((s) => s.isReadOnly);
  const importPresetToMyDecks = useDeckStore((s) => s.importPresetToMyDecks);
  const {
    currentDeck,
    savedDecks,
    removeFromMain,
    removeFromSide,
    addToMain,
    addToSide,
    setDeckName,
    clearDeck,
    setDeckFormat,
    saveCurrentDeck,
    saveDraft,
    addToMaybe,
    removeFromMaybe,
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
    updatePrint,
    toggleFoil,
    removeToken,
  } = useDeckStore();

  const derivedTokens = useDerivedTokens(currentDeck);
  const mergedTokens = useMemo(
    () => mergeDerivedAndCustomized(derivedTokens, currentDeck.tokens),
    [derivedTokens, currentDeck.tokens],
  );

  const [editingName, setEditingName] = useState(false);
  const [deckFilter, setDeckFilter] = useState("");
  const [newTagInput, setNewTagInput] = useState("");
  const [nameInput, setNameInput] = useState(currentDeck.name);

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [cardSize, setCardSize] = useState(3);
  const [groupBy, setGroupBy] = useState<GroupByMode>("type");
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => {
    const snap = buildDeckSnapshot(currentDeck);
    setLastSavedSnapshotRef(snap);
    return snap;
  });
  const [pendingSwitchAction, setPendingSwitchAction] = useState<(() => void) | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [pendingDeleteDeck, setPendingDeleteDeck] = useState<{ id: string; name: string } | null>(
    null,
  );
  const nameInputRef = useRef<HTMLInputElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const enrichedNamesRef = useRef(new Set<string>());

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  const currentSnapshot = buildDeckSnapshot(currentDeck);
  // Read-only presets can't be edited; background Scryfall enrichment mutates the
  // deck after the baseline snapshot, so never treat a preset as dirty.
  const hasUnsavedChanges = !isReadOnly && currentSnapshot !== lastSavedSnapshot;

  // Sync shared unsaved state for DeckEditor blocker
  useEffect(() => {
    setLastSavedSnapshotRef(lastSavedSnapshot);
    setUnsavedState(lastSavedSnapshot, isReadOnly ? lastSavedSnapshot : currentSnapshot);
  }, [lastSavedSnapshot, currentSnapshot, isReadOnly]);

  // Reset snapshot when a deck is loaded
  const deckIdentity = `${currentDeck.name}:${savedDecks.length}`;
  const [prevDeckIdentity, setPrevDeckIdentity] = useState(deckIdentity);
  if (prevDeckIdentity !== deckIdentity) {
    setPrevDeckIdentity(deckIdentity);
    const snapshot = buildDeckSnapshot(currentDeck);
    setLastSavedSnapshot(snapshot);
    setUnsavedState(snapshot, snapshot);
  }

  // Warn on navigation/tab close with unsaved changes
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const { selectedCards, toggleCard, rangeSelect, clearSelection, selectCards } =
    useDeckSelection();

  const preview = useCardPreview();

  const { setNodeRef: setMainDropRef, isOver: isOverMain } = useDroppable({ id: DROP_ZONE.MAIN });
  const { setNodeRef: setSideDropRef, isOver: isOverSide } = useDroppable({ id: DROP_ZONE.SIDE });
  const { setNodeRef: setMaybeDropRef, isOver: isOverMaybe } = useDroppable({
    id: DROP_ZONE.MAYBE,
  });

  // Auto-enrich cards missing CMC/mana data, or missing the allParts contract
  // (legacy saved decks predate this field).
  useEffect(() => {
    const allCards = [...currentDeck.cards, ...supplementaryCards];
    const toFetch = allCards
      .filter((c) => {
        if (enrichedNamesRef.current.has(c.name.toLowerCase())) return false;
        const needsBasicMeta = (c.cmc === undefined || c.cmc === null) && !c.manaCost;
        const needsAllParts = c.allParts === undefined;
        return needsBasicMeta || needsAllParts;
      })
      .map((c) => c.name);
    if (toFetch.length === 0) return;
    const uniqueNames = [...new Set(toFetch)];
    uniqueNames.forEach((n) => enrichedNamesRef.current.add(n.toLowerCase()));
    fetchCardCollection(uniqueNames.map((n) => ({ name: n })))
      .then((scryfallMap) => {
        const updates = new Map<string, Partial<DeckCard>>();
        for (const [key, sc] of scryfallMap) updates.set(key, scryfallToDeckCard(sc));
        enrichDeckCards(updates);
      })
      .catch((err) => {
        console.warn("[DeckBuilder] Failed to enrich card images:", err);
      });
  }, [currentDeck.cards, supplementaryCards, enrichDeckCards]);

  // ESC to clear selection
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelection();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection]);

  // Bulk selection actions
  function bulkAction(action: (name: string) => void, message: string) {
    for (const name of selectedCards) action(name);
    clearSelection();
    toast.success(message);
  }

  const handleRemoveSelected = () =>
    bulkAction(
      (name) =>
        currentDeck.cards
          .filter((c) => c.name.toLowerCase() === name)
          .forEach((c) => removeFromMain(c.id)),
      `Removed ${selectedCards.size} cards`,
    );
  const handleMoveSelectedToSide = () =>
    bulkAction(
      (name) =>
        currentDeck.cards
          .filter((c) => c.name.toLowerCase() === name)
          .forEach((c) => {
            removeFromMain(c.id);
            addToSide({ ...c, id: crypto.randomUUID() });
          }),
      `Moved ${selectedCards.size} cards to sideboard`,
    );
  const handleMoveSelectedToMain = () =>
    bulkAction(
      (name) =>
        supplementaryCards
          .filter((c) => c.name.toLowerCase() === name)
          .forEach((c) => {
            removeFromSide(c.id);
            addToMain({ ...c, id: crypto.randomUUID() });
          }),
      `Moved ${selectedCards.size} cards to main`,
    );
  const handleTagSelected = (tag: string) =>
    bulkAction((name) => tagCard(name, tag), `Tagged ${selectedCards.size} cards with "${tag}"`);
  const handleUntagSelected = (tag: string) =>
    bulkAction(
      (name) => untagCard(name, tag),
      `Untagged ${selectedCards.size} cards from "${tag}"`,
    );

  // Tags that any of the selected cards belong to
  const selectedCardTags = (() => {
    if (selectedCards.size === 0 || !currentDeck.cardTags) return [];
    const tags = new Set<string>();
    for (const name of selectedCards) {
      const cardTagList = currentDeck.cardTags[name];
      if (cardTagList) cardTagList.forEach((t) => tags.add(t));
    }
    return [...tags];
  })();

  // Filter
  const unsupportedNames = useUnsupportedCards(currentDeck);
  const hasUnsupportedCards = unsupportedNames.size > 0;

  // Compute deck legality for conditional save button
  const deckFormat = getFormat(currentDeck.format ?? "standard");
  const isDeckLegal =
    !hasUnsupportedCards &&
    (deckFormat
      ? validateDeckSections(
          {
            deck: currentDeck,
            commanderName: currentDeck.commanders?.[0]?.name,
          },
          deckFormat,
        ).legal
      : false);

  const filterLc = deckFilter.toLowerCase();
  const filteredMain = useMemo(
    () =>
      filterLc
        ? currentDeck.cards.filter((c) => c.name.toLowerCase().includes(filterLc))
        : currentDeck.cards,
    [filterLc, currentDeck.cards],
  );
  // Compute groups
  const { sections: sectionGroups, otherGroups } = computeGroupedSections(
    filteredMain,
    groupBy,
    currentDeck.customTags,
    currentDeck.cardTags,
  );
  const sideGroups = groupCards(
    filterLc
      ? currentDeck.sideboard.filter((c) => c.name.toLowerCase().includes(filterLc))
      : currentDeck.sideboard,
  );
  const attractionGroups = groupCards(
    filterLc
      ? (currentDeck.attractions ?? []).filter((c) => c.name.toLowerCase().includes(filterLc))
      : (currentDeck.attractions ?? []),
  );
  const contraptionGroups = groupCards(
    filterLc
      ? (currentDeck.contraptions ?? []).filter((c) => c.name.toLowerCase().includes(filterLc))
      : (currentDeck.contraptions ?? []),
  );
  const schemeGroups = groupCards(
    filterLc
      ? (currentDeck.schemes ?? []).filter((c) => c.name.toLowerCase().includes(filterLc))
      : (currentDeck.schemes ?? []),
  );
  const planeGroups = groupCards(
    filterLc
      ? (currentDeck.planes ?? []).filter((c) => c.name.toLowerCase().includes(filterLc))
      : (currentDeck.planes ?? []),
  );
  const maybeGroups = groupCards(
    filterLc
      ? (currentDeck.maybeboard ?? []).filter((c) => c.name.toLowerCase().includes(filterLc))
      : (currentDeck.maybeboard ?? []),
  );
  const specialSections = [
    { id: "attractions", label: "Attractions", groups: attractionGroups },
    { id: "contraptions", label: "Contraptions", groups: contraptionGroups },
    { id: "schemes", label: "Schemes", groups: schemeGroups },
    { id: "planes", label: "Planes", groups: planeGroups },
  ].filter((section) => section.groups.length > 0);
  const stackColsData = useMemo(
    () =>
      computeGroupedStackColumns(
        filteredMain,
        groupBy,
        currentDeck.customTags,
        currentDeck.cardTags,
      ),
    [filteredMain, groupBy, currentDeck.customTags, currentDeck.cardTags],
  );

  // ── Handlers ──

  function handleRemoveOneFromMain(cardName: string) {
    const card = [...currentDeck.cards].reverse().find((c) => c.name === cardName);
    if (card) removeFromMain(card.id);
  }

  function handleRemoveAllFromMain(cardName: string) {
    currentDeck.cards.filter((c) => c.name === cardName).forEach((c) => removeFromMain(c.id));
  }

  function handleMoveOneToSide(cardName: string) {
    const card = [...currentDeck.cards].reverse().find((c) => c.name === cardName);
    if (!card) return;
    removeFromMain(card.id);
    addToSide({ ...card, id: crypto.randomUUID() });
    toast.success(`Moved 1 ${cardName} to sideboard`);
  }

  function handleMoveAllToSide(cardName: string) {
    const copies = currentDeck.cards.filter((c) => c.name === cardName);
    if (copies.length === 0) return;
    for (const c of copies) {
      removeFromMain(c.id);
      addToSide({ ...c, id: crypto.randomUUID() });
    }
    toast.success(`Moved ${copies.length} ${cardName} to sideboard`);
  }

  function handleMoveOneToMaybe(cardName: string) {
    const card = [...currentDeck.cards].reverse().find((c) => c.name === cardName);
    if (!card) return;
    removeFromMain(card.id);
    addToMaybe({ ...card, id: crypto.randomUUID() });
    toast.success(`Moved 1 ${cardName} to maybeboard`);
  }

  function handleMoveAllToMaybe(cardName: string) {
    const copies = currentDeck.cards.filter((c) => c.name === cardName);
    if (copies.length === 0) return;
    for (const c of copies) {
      removeFromMain(c.id);
      addToMaybe({ ...c, id: crypto.randomUUID() });
    }
    toast.success(`Moved ${copies.length} ${cardName} to maybeboard`);
  }

  function handleRemoveOneFromMaybe(cardName: string) {
    const card = [...(currentDeck.maybeboard ?? [])].reverse().find((c) => c.name === cardName);
    if (card) removeFromMaybe(card.id);
  }

  function handleShowInfo(cardName: string) {
    if (isReadOnly) return;
    // Find the card in the deck to pass its stored setCode for accurate printing
    const allCards = [
      ...currentDeck.cards,
      ...supplementaryCards,
      ...(currentDeck.commanders ?? []),
    ];
    const deckCard = allCards.find((c) => c.name === cardName);
    const token = mergedTokens.find((t) => t.name === cardName);
    const lookup = deckCard
      ? {
          name: deckCard.name,
          setCode: deckCard.setCode,
          collectorNumber: deckCard.cardNumber,
        }
      : {
          name: cardName,
          setCode: token?.setCode,
          collectorNumber: token?.cardNumber,
        };
    useScryfallStore
      .getState()
      .getCard(lookup)
      .then((sc) => setDetailCard(sc.info))
      .catch(() => toast.error(`Could not fetch info for "${cardName}"`));
  }

  function handleRemoveOneFromSide(cardName: string) {
    const card = [...supplementaryCards].reverse().find((c) => c.name === cardName);
    if (card) removeFromSide(card.id);
  }

  function handleMoveOneFromSideToMain(cardName: string) {
    const card = [...currentDeck.sideboard].reverse().find((c) => c.name === cardName);
    if (!card) return;
    removeFromSide(card.id);
    addToMain({ ...card, id: crypto.randomUUID() });
    toast.success(`Moved 1 ${cardName} to main`);
  }

  function handleMoveAllFromSideToMain(cardName: string) {
    const copies = currentDeck.sideboard.filter((c) => c.name === cardName);
    if (copies.length === 0) return;
    for (const c of copies) {
      removeFromSide(c.id);
      addToMain({ ...c, id: crypto.randomUUID() });
    }
    toast.success(`Moved ${copies.length} ${cardName} to main`);
  }

  function handleMoveOneFromSideToMaybe(cardName: string) {
    const card = [...currentDeck.sideboard].reverse().find((c) => c.name === cardName);
    if (!card) return;
    removeFromSide(card.id);
    addToMaybe({ ...card, id: crypto.randomUUID() });
    toast.success(`Moved 1 ${cardName} to maybeboard`);
  }

  function handleMoveAllFromSideToMaybe(cardName: string) {
    const copies = currentDeck.sideboard.filter((c) => c.name === cardName);
    if (copies.length === 0) return;
    for (const c of copies) {
      removeFromSide(c.id);
      addToMaybe({ ...c, id: crypto.randomUUID() });
    }
    toast.success(`Moved ${copies.length} ${cardName} to maybeboard`);
  }

  function handleMoveOneFromMaybeToMain(cardName: string) {
    const card = [...(currentDeck.maybeboard ?? [])].reverse().find((c) => c.name === cardName);
    if (!card) return;
    removeFromMaybe(card.id);
    addToMain({ ...card, id: crypto.randomUUID() });
    toast.success(`Moved 1 ${cardName} to main`);
  }

  function handleMoveAllFromMaybeToMain(cardName: string) {
    const copies = (currentDeck.maybeboard ?? []).filter((c) => c.name === cardName);
    if (copies.length === 0) return;
    for (const c of copies) {
      removeFromMaybe(c.id);
      addToMain({ ...c, id: crypto.randomUUID() });
    }
    toast.success(`Moved ${copies.length} ${cardName} to main`);
  }

  function handleMoveOneFromMaybeToSide(cardName: string) {
    const card = [...(currentDeck.maybeboard ?? [])].reverse().find((c) => c.name === cardName);
    if (!card) return;
    removeFromMaybe(card.id);
    addToSide({ ...card, id: crypto.randomUUID() });
    toast.success(`Moved 1 ${cardName} to sideboard`);
  }

  function handleMoveAllFromMaybeToSide(cardName: string) {
    const copies = (currentDeck.maybeboard ?? []).filter((c) => c.name === cardName);
    if (copies.length === 0) return;
    for (const c of copies) {
      removeFromMaybe(c.id);
      addToSide({ ...c, id: crypto.randomUUID() });
    }
    toast.success(`Moved ${copies.length} ${cardName} to sideboard`);
  }

  function handleSetCommander(card: DeckCard) {
    if (!isCommanderEligible(card)) {
      toast.error(`"${card.name}" is not a legal commander`);
      return;
    }

    const existing = currentDeck.commanders ?? [];
    if (existing.length >= 1 && !canBePartners(existing[0], card)) {
      // Incompatible pairing — explain why before the store silently replaces
      const existingHasPartner =
        hasPartner(existing[0]) || getPartnerWithName(existing[0]) !== null;
      const newHasPartner = hasPartner(card) || getPartnerWithName(card) !== null;

      if (!existingHasPartner && !newHasPartner) {
        toast.info(`"${existing[0].name}" replaced — neither commander has a partner ability`);
      } else if (!existingHasPartner) {
        toast.info(`"${existing[0].name}" replaced — it doesn't have a partner ability`);
      } else if (!newHasPartner) {
        toast.info(`"${card.name}" set as sole commander — it doesn't have a partner ability`);
      } else {
        toast.info(
          `"${existing[0].name}" replaced — "${card.name}" must partner with a different card`,
        );
      }
    }

    setCommander(card);
  }

  function isAtCopyLimit(cardName: string): boolean {
    if (BASIC_LAND_NAMES.has(cardName)) return false;
    const format = getFormat(currentDeck.format ?? "standard");
    if (!format) return false;
    const copies = currentDeck.cards.filter((c) => c.name === cardName);
    const limit =
      (copies.length > 0 ? copyLimitFromText(copies[0].text) : null) ?? format.deckRules.maxCopies;
    return copies.length >= limit;
  }

  function handleAddOneToMain(group: CardGroup) {
    if (isAtCopyLimit(group.card.name)) {
      const format = getFormat(currentDeck.format ?? "standard");
      toast.error(
        `Max ${format?.deckRules.maxCopies} copies of "${group.card.name}" allowed in ${format?.name}`,
      );
      return;
    }
    addToMain({ ...group.card, id: crypto.randomUUID() });
  }

  function handleAddOneToMainByName(cardName: string) {
    if (isAtCopyLimit(cardName)) {
      const format = getFormat(currentDeck.format ?? "standard");
      toast.error(
        `Max ${format?.deckRules.maxCopies} copies of "${cardName}" allowed in ${format?.name}`,
      );
      return;
    }
    const existing = currentDeck.cards.find((c) => c.name === cardName);
    if (existing) addToMain({ ...existing, id: crypto.randomUUID() });
  }

  function confirmName() {
    if (nameInput.trim()) setDeckName(nameInput.trim());
    setEditingName(false);
  }

  function handleExport() {
    const text = exportToArena(currentDeck);
    navigator.clipboard.writeText(text).then(() => toast.success("Deck copied to clipboard"));
  }

  function handleSave() {
    if (hasUnsupportedCards) {
      handleSaveDraft();
      return;
    }
    saveCurrentDeck();
    const snapshot = buildDeckSnapshot(currentDeck);
    setLastSavedSnapshot(snapshot);
    setUnsavedState(snapshot, snapshot);
  }

  function handleSaveDraft() {
    saveDraft();
    const snapshot = buildDeckSnapshot({ ...currentDeck, draft: true });
    setLastSavedSnapshot(snapshot);
    setUnsavedState(snapshot, snapshot);
    if (hasUnsupportedCards) {
      toast.warning(
        `Saved "${currentDeck.name}" as draft — ${unsupportedNames.size} card${unsupportedNames.size === 1 ? "" : "s"} not implemented by the engine`,
      );
    } else {
      toast.success(`Draft "${currentDeck.name}" saved`);
    }
  }

  /**
   * Unified card-selection handler passed down to DeckListView.
   * Plain click → toggle individual card (others stay selected).
   * Shift+click → select the range from the last-clicked card to this one.
   */
  function handleSelectCard(cardName: string, shiftKey: boolean) {
    if (shiftKey) {
      const orderedNames: string[] = [];
      for (const c of currentDeck.commanders ?? []) orderedNames.push(c.name);
      for (const s of sectionGroups) for (const g of s.groups) orderedNames.push(g.card.name);
      for (const g of otherGroups) orderedNames.push(g.card.name);
      rangeSelect(cardName, orderedNames);
    } else {
      toggleCard(cardName);
    }
  }

  /** If unsaved changes exist, queue the action behind a confirm dialog. Otherwise run it immediately. */
  function guardUnsaved(action: () => void) {
    if (hasUnsavedChanges) {
      setPendingSwitchAction(() => action);
    } else {
      action();
    }
  }

  function handleImportPresetToMyDecks() {
    const importedName = currentDeck.name;
    importPresetToMyDecks();
    toast.success(`Imported "${importedName}" — now editable`);
  }

  const coverArt = resolveCoverCard(currentDeck)?.uris?.art_crop;

  return (
    <div className="flex flex-col h-full w-full relative">
      {isReadOnly && (
        <div className="px-3 py-2 border-b border-warning/40 shrink-0 flex items-center gap-2 bg-warning/10">
          <Bookmark className="h-3.5 w-3.5 text-warning shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wide text-warning shrink-0">
            Preset deck — read only
          </span>
          <span className="text-xs text-warning/70 truncate flex-1">
            Browse the cards below. Editing is locked.
          </span>
          <Button size="sm" className="h-7 shrink-0" onClick={handleImportPresetToMyDecks}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Import to my decks
          </Button>
        </div>
      )}
      <fieldset disabled={isReadOnly} className="contents">
        {/* ── Header: deck identity + quick add + save ── */}
        <div
          className={cn(
            "relative isolate overflow-hidden px-3 py-3 border-b shrink-0 flex items-center gap-2",
            isReadOnly && "bg-muted/15",
          )}
        >
          {coverArt && (
            <ScryfallImg
              src={coverArt}
              alt=""
              aria-hidden
              draggable={false}
              loading="lazy"
              className="pointer-events-none absolute inset-0 -z-10 size-full select-none object-cover object-top opacity-30 blur-xs"
            />
          )}
          {onBack && (
            <div
              role="button"
              tabIndex={0}
              className="h-7 w-7 shrink-0 rounded-md inline-flex items-center justify-center cursor-pointer hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Back to My Decks"
              onClick={() => guardUnsaved(onBack)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  guardUnsaved(onBack);
                }
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </div>
          )}

          {/* Radix portals escape the fieldset disabled cascade — gate name + format explicitly. */}
          {isReadOnly ? (
            <span className="font-semibold text-base shrink-0 px-1.5 py-0.5">
              {currentDeck.name}
            </span>
          ) : editingName ? (
            <div className="flex items-center gap-1 shrink-0">
              <Input
                ref={nameInputRef}
                className="h-7 text-sm font-semibold w-40"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmName();
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setNameInput(currentDeck.name);
                  }
                }}
                autoFocus
              />
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={confirmName}>
                <Check className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1 shrink-0 min-w-0 hover:bg-muted/60 rounded px-1.5 py-0.5 transition-colors"
              onClick={() => {
                setNameInput(currentDeck.name);
                setEditingName(true);
              }}
            >
              <span className="font-semibold text-base whitespace-nowrap">{currentDeck.name}</span>
            </button>
          )}

          {isReadOnly ? (
            <span className="shrink-0">
              <FormatBadge formatId={currentDeck.format ?? "standard"} />
            </span>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="shrink-0 cursor-pointer flex items-center gap-1">
                  <FormatBadge formatId={currentDeck.format ?? "standard"} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {GAME_FORMATS.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => setDeckFormat(f.id as DeckFormatId)}
                    className="gap-2"
                  >
                    <FormatBadge formatId={f.id} />
                    <span className="text-xs">{f.name}</span>
                    {(currentDeck.format ?? "standard") === f.id && (
                      <Check className="h-3 w-3 ml-auto text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Labels */}
          {(currentDeck.labels ?? []).map((label) => (
            <DeckLabelBadge key={label.name} label={label} size="md" className="shrink-0" />
          ))}

          <div className="flex-1" />

          {/* Right: Save + overflow menu */}
          {isReadOnly ? (
            <Button
              size="sm"
              variant="ghost"
              disabled
              className="h-7 shrink-0 gap-1 text-xs text-muted-foreground/60"
              title="Preset deck — import to enable editing"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          ) : isDeckLegal ? (
            <Button
              size="sm"
              variant={hasUnsavedChanges ? "default" : "secondary"}
              disabled={!hasUnsavedChanges}
              className="h-7 shrink-0 gap-1 text-xs"
              title={hasUnsavedChanges ? "Save deck (unsaved changes)" : "Deck saved"}
              onClick={handleSave}
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 text-xs border-warning/50 text-warning hover:bg-warning/10"
              title={
                hasUnsupportedCards
                  ? `${unsupportedNames.size} card${unsupportedNames.size === 1 ? "" : "s"} not implemented by the engine — draft only, can't be played`
                  : "Deck has errors — save as draft (not playable)"
              }
              onClick={handleSaveDraft}
            >
              <FileBox className="h-3.5 w-3.5" />
              Save Draft
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0">
                <EllipsisVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onSelect={handleExport}
                disabled={currentDeck.cards.length === 0 && !currentDeck.commanders?.length}
              >
                <ClipboardCopy className="h-3.5 w-3.5 mr-2" /> Export to clipboard
              </DropdownMenuItem>
              <div className="border-t my-1" />
              <DropdownMenuItem onSelect={() => setLabelsOpen(true)}>
                <Palette className="h-3.5 w-3.5 mr-2" /> Labels
                {(currentDeck.labels?.length ?? 0) > 0 && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {currentDeck.labels!.length}
                  </span>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                <Bookmark className="h-3.5 w-3.5 mr-2" /> Tags
                {(currentDeck.customTags?.length ?? 0) > 0 && (
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {currentDeck.customTags!.length}
                  </span>
                )}
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
                          removeCustomTag(tag);
                          toast.success(`Tag "${tag}" removed`);
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
                  placeholder="New tag…"
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter" && newTagInput.trim()) {
                      addCustomTag(newTagInput.trim());
                      toast.success(`Tag "${newTagInput.trim()}" added`);
                      setNewTagInput("");
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="border-t my-1" />
              <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmClear(true)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete deck
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </fieldset>

      <div className="flex flex-1 min-h-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* View toolbar lives outside the readonly fieldset — none of these mutate the deck. */}
          <div className="mt-2 px-3 py-1 shrink-0 flex items-center gap-2">
            <div className="relative shrink-0 w-28">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                ref={filterInputRef}
                className="h-6 text-xs pl-6 pr-6"
                placeholder="Filter…"
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
                max={5}
                step={1}
                value={cardSize}
                onChange={(e) => setCardSize(Number(e.target.value))}
                className="w-32 h-1 cursor-pointer accent-primary shrink-0"
                title={`Card size: ${cardSize}`}
              />
            )}
            <div className="flex-1 min-w-0">
              <QuickCardSearch
                onAdd={(sc) => {
                  if (isAtCopyLimit(sc.name)) {
                    const format = getFormat(currentDeck.format ?? "standard");
                    toast.error(
                      `Max ${format?.deckRules.maxCopies} copies of "${sc.name}" allowed in ${format?.name}`,
                    );
                    return;
                  }
                  addToMain(scryfallToDeckCard(sc));
                  toast.success(`Added ${sc.name}`);
                }}
                onRemove={(name) => {
                  handleRemoveOneFromMain(name);
                }}
                getCount={(name) => currentDeck.cards.filter((c) => c.name === name).length}
              />
            </div>
            {onToggleSearch && (
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                title="Toggle card search"
                onClick={onToggleSearch}
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          <fieldset disabled={isReadOnly} className="contents">
            <div className={cn("flex-1 min-h-0 flex", isReadOnly && "opacity-60 bg-muted/15")}>
              <div
                ref={setMainDropRef}
                className={cn(
                  "flex-1 min-w-0 transition-colors overflow-hidden",
                  isOverMain && !isOverSide && "bg-primary/5",
                )}
              >
                <DeckListView
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
                  onRemoveCommander={removeCommander}
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
                  onPickPrint={(name) => setPrintPickerCard(name)}
                  onToggleFoil={toggleFoil}
                  onHover={(card, e) =>
                    preview.handleMouseEnter(card as unknown as GameCard, e, { useDelay: true })
                  }
                  onLeave={preview.handleMouseLeave}
                  onAddToSide={(card) => addToSide(card)}
                  onRemoveFromSide={handleRemoveOneFromSide}
                  onAddToMaybe={(card) => addToMaybe(card)}
                  onRemoveFromMaybe={handleRemoveOneFromMaybe}
                  totalCards={currentDeck.cards.length + (currentDeck.commanders?.length ?? 0)}
                  customTags={currentDeck.customTags}
                  cardTags={currentDeck.cardTags}
                  allMainCards={currentDeck.cards}
                  onUntagCard={untagCard}
                  onTagCard={tagCard}
                  onAddCustomTag={addCustomTag}
                  onRemoveTag={removeCustomTag}
                  selectedCards={selectedCards}
                  onSelectCard={handleSelectCard}
                  onSelectAll={(names) => selectCards(names, true)}
                  onShowInfo={handleShowInfo}
                  coverCardName={currentDeck.coverCardName}
                  coverCardFace={currentDeck.coverCardFace}
                  onSetCover={(card) => {
                    const isSameFront =
                      currentDeck.coverCardName === card.name &&
                      (currentDeck.coverCardFace ?? 0) === 0;
                    setCoverCard(isSameFront ? undefined : card.name, 0);
                    if (!isSameFront) useScryfallStore.getState().invalidateCard(card.name);
                  }}
                  onSetCoverBack={(card) => {
                    const isSameBack =
                      currentDeck.coverCardName === card.name && currentDeck.coverCardFace === 1;
                    setCoverCard(isSameBack ? undefined : card.name, 1);
                    if (!isSameBack) useScryfallStore.getState().invalidateCard(card.name);
                  }}
                  stackPositions={currentDeck.stackPositions}
                  onStackPositionsChange={setStackPositions}
                />
              </div>
            </div>
          </fieldset>
        </div>
        {setPreviewSlot && onTogglePreview && (
          <PreviewRail
            setSlot={setPreviewSlot}
            collapsed={previewCollapsed ?? false}
            onCollapse={onTogglePreview}
          />
        )}
      </div>

      <fieldset disabled={isReadOnly} className="contents">
        {selectedCards.size > 0 && (
          <div className="absolute bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-selection/30 px-4 py-2 flex items-center gap-2 z-50">
            <span className="text-sm font-medium text-selection">
              {selectedCards.size} card{selectedCards.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={handleMoveSelectedToMain}>
              <ArrowUpToLine className="h-3 w-3 mr-1" /> To Main
            </Button>
            <Button size="sm" variant="outline" onClick={handleMoveSelectedToSide}>
              <ArrowDownToLine className="h-3 w-3 mr-1" /> To Sideboard
            </Button>
            {(currentDeck.customTags?.length ?? 0) > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Bookmark className="h-3 w-3 mr-1" /> Tag
                    <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {currentDeck.customTags!.map((tag) => (
                    <DropdownMenuItem key={tag} onSelect={() => handleTagSelected(tag)}>
                      <Bookmark className="h-3 w-3 mr-2 text-primary/60" />
                      {tag}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {selectedCardTags.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline">
                    <BookmarkMinus className="h-3 w-3 mr-1" /> Untag
                    <ChevronDown className="h-3 w-3 ml-1 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {selectedCardTags.map((tag) => (
                    <DropdownMenuItem key={tag} onSelect={() => handleUntagSelected(tag)}>
                      <BookmarkMinus className="h-3 w-3 mr-2 text-destructive" />
                      {tag}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" variant="destructive" onClick={handleRemoveSelected}>
              <X className="h-3 w-3 mr-1" /> Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        )}

        <DeckValidationPanel unsupportedNames={unsupportedNames} />
        <TokenSection
          tokens={mergedTokens}
          cardSize={cardSize}
          onShowInfo={handleShowInfo}
          onPickPrint={setTokenPrintPickerName}
          onRemoveToken={removeToken}
          onHover={(token, e) =>
            preview.handleMouseEnter(token as unknown as GameCard, e, { useDelay: true })
          }
          onLeave={preview.handleMouseLeave}
        />
        <DeckStats />

        <HoverCardPreview preview={preview} slot={previewSlot} pinned imageSize="normal" />
        <PrintPickerModal cardName={printPickerCard} onClose={() => setPrintPickerCard(null)} />
        <PrintPickerModal
          cardName={tokenPrintPickerName}
          onClose={() => setTokenPrintPickerName(null)}
          onSelect={(sc) => {
            if (tokenPrintPickerName) updatePrint(tokenPrintPickerName, sc);
          }}
          isToken
        />
        {detailCard && (
          <CardDetailModal
            card={detailCard}
            onClose={() => setDetailCard(null)}
            deckEditorActions={{
              onAddOne: handleAddOneToMainByName,
              onRemoveOne: handleRemoveOneFromMain,
              onPickPrint: (name) => setPrintPickerCard(name),
              onSetCommander: (name) => {
                const existing = currentDeck.commanders?.find((c) => c.name === name);
                if (existing) {
                  removeCommander(existing);
                } else {
                  const card = currentDeck.cards.find((c) => c.name === name);
                  if (card) handleSetCommander(card);
                }
              },
              isCommander: detailCard
                ? (currentDeck.commanders?.some((c) => c.name === detailCard.name) ?? false)
                : false,
              deckFormat: currentDeck.format ?? "standard",
              customTags: currentDeck.customTags,
              onTagCard: tagCard,
              onAddTag: addCustomTag,
              isToken: detailCard ? mergedTokens.some((t) => t.name === detailCard.name) : false,
              onUpdateTokenPrint: updatePrint,
            }}
          />
        )}
        <DeckLabelsModal open={labelsOpen} onClose={() => setLabelsOpen(false)} />

        {/* Clear/delete deck confirm dialog */}
        {confirmClear && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/50 backdrop-blur-sm">
            <div className="bg-card border rounded-xl shadow-xl p-6 max-w-sm space-y-4">
              <h3 className="text-lg font-semibold">Clear Deck</h3>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to clear &quot;{currentDeck.name}&quot;? This will remove all
                cards and delete the saved deck.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    // Delete the saved deck if it exists
                    const deckId = useDeckStore.getState().currentDeckId;
                    if (deckId) deleteSavedDeck(deckId);
                    clearDeck();
                    setConfirmClear(false);
                    const snapshot = buildDeckSnapshot({
                      format: "standard",
                      cards: [],
                      sideboard: [],
                      commanders: [],
                      attractions: [],
                      contraptions: [],
                      schemes: [],
                      planes: [],
                      name: DEFAULT_DECK_NAME,
                    });
                    setLastSavedSnapshot(snapshot);
                    setUnsavedState(snapshot, snapshot);
                    toast.success("Deck deleted");
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Unsaved changes confirm dialog (for deck switching) */}
        {pendingSwitchAction && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-overlay/50 backdrop-blur-sm">
            <div className="bg-card border rounded-xl shadow-xl p-6 max-w-sm space-y-4">
              <h3 className="text-lg font-semibold">Unsaved Changes</h3>
              <p className="text-sm text-muted-foreground">
                You have unsaved changes. Do you want to discard them?
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setPendingSwitchAction(null)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    handleSave();
                    pendingSwitchAction();
                    setPendingSwitchAction(null);
                  }}
                >
                  Save & Switch
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    pendingSwitchAction();
                    setPendingSwitchAction(null);
                  }}
                >
                  Discard
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Delete deck confirmation (from My Decks dropdown) */}
        <Dialog
          open={!!pendingDeleteDeck}
          onOpenChange={(open) => {
            if (!open) setPendingDeleteDeck(null);
          }}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Delete Deck</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete &ldquo;{pendingDeleteDeck?.name}&rdquo;? This action
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingDeleteDeck(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  if (pendingDeleteDeck) {
                    deleteSavedDeck(pendingDeleteDeck.id);
                    toast.success(`Deleted "${pendingDeleteDeck.name}"`);
                    setPendingDeleteDeck(null);
                  }
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </fieldset>
    </div>
  );
}
