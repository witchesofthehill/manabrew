import { DeckBuilder } from "@/components/editor/DeckBuilder";
import {
  useDeckUnsavedChanges,
  revertDeckToLastSaved,
} from "@/components/editor/deckBuilder.unsavedChanges";
import { CardSearch } from "@/components/editor/CardSearch";
import { useKeybindings } from "@/hooks/useKeybindings";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { useDeckStore } from "@/stores/useDeckStore";
import { DROP_ZONE, DEFAULT_DECK_NAME } from "@/lib/constants";
import { useEffect, useRef, useState } from "react";
import type { DeckCard } from "@/protocol/deck";
import type { Deck as DeckType } from "@/protocol/deck";
import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { useBlocker, useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeckGridCard } from "@/components/deck/DeckGridCard";
import { DeckListControls } from "@/components/deck/DeckListControls";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { ImportDeckTextDialog } from "@/components/editor/ImportDeckTextDialog";
import { NewDeckChoiceDialog } from "@/components/editor/NewDeckChoiceDialog";
import { inferImportedFormat, type ParsedDeckEntry } from "@/lib/deckImport";
import { fetchCardCollection, fetchCardByFuzzyName } from "@/api/scryfall";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { applyDeckFilters } from "@/views/myDecks.utils";
import type { SortBy } from "@/views/myDecks.utils";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useNavigate } from "react-router";
import type { SavedDeck } from "@/stores/useDeckStore";

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
    addSavedDeck,
    currentDeckId: _currentDeckId,
  } = useDeckStore();
  const isReadOnly = useDeckStore((s) => s.isReadOnly);
  const loadPresetDeck = useDeckStore((s) => s.loadPresetDeck);
  const presetDecks = usePresetDecks();
  const navigate = useNavigate();

  function handleOpenPreset(deck: DeckType) {
    setSearchParams({ deck: `preset:${deck.id ?? deck.name}` });
  }

  const presetSavedDecksUnfiltered: SavedDeck[] = presetDecks.map((deck) => ({
    id: `preset:${deck.id ?? deck.name}`,
    deck,
    savedAt: 0,
  }));
  const [draggedCard, setDraggedCard] = useState<DeckCard | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [choiceDialogOpen, setChoiceDialogOpen] = useState(false);

  useKeybindings({
    "card-search-focus": () => {
      setShowSearch(true);
      setSearchFocusSignal((n) => n + 1);
    },
    "deck-editor-toggle-preview": () => togglePreview(),
    "go-back": () => handleBack(),
  });
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
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentDeckId = useDeckStore((s) => s.currentDeckId);

  const [stateView, setStateView] = useState<"list" | "editor">(() => {
    if (useDeckStore.getState().isReadOnly) return "editor";
    return (location.state as { directToEditor?: boolean } | null)?.directToEditor
      ? "editor"
      : "list";
  });
  // True when readonly was triggered by an in-page preset click (no route
  // navigation), so Back restores the grid instead of popping history.
  const [readonlyEnteredInPage, setReadonlyEnteredInPage] = useState(false);
  const view = isReadOnly ? "editor" : stateView;
  const setView = setStateView;
  const [showBackConfirm, setShowBackConfirm] = useState(false);

  const [search, setSearch] = useState("");
  const [formatFilter, setFormatFilter] = useState("");
  const [colorFilter, setColorFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortBy>("name");

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState("");

  const blocker = useBlocker(hasUnsavedChanges && view === "editor" && !isReadOnly);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    return () => {
      useDeckStore.getState().clearDeck();
    };
  }, []);

  const restoredParamRef = useRef<string | null>(null);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const deckParam = searchParams.get("deck");
    if (!deckParam) {
      restoredParamRef.current = null;
      return;
    }
    if (restoredParamRef.current === deckParam) return;

    if (deckParam.startsWith("preset:")) {
      const presetId = deckParam.slice("preset:".length);
      const preset = presetDecks.find((d) => (d.id ?? d.name) === presetId);
      if (!preset) return;
      loadPresetDeck(preset);
      setReadonlyEnteredInPage(true);
      setStateView("editor");
      restoredParamRef.current = deckParam;
      return;
    }

    const saved = savedDecks.find((s) => s.id === deckParam);
    if (!saved) return;
    loadSavedDeck(deckParam);
    setStateView("editor");
    restoredParamRef.current = deckParam;
  }, [searchParams, presetDecks, savedDecks, loadPresetDeck, loadSavedDeck]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (isReadOnly ? false : stateView !== "editor") return;
    if (!currentDeckId) return;
    if (searchParams.get("deck") === currentDeckId) return;
    setSearchParams({ deck: currentDeckId }, { replace: true });
  }, [currentDeckId, stateView, isReadOnly, searchParams, setSearchParams]);

  function toggleColor(color: string) {
    setColorFilter((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  }

  const deckFilterArgs = { search, formatFilter, colorFilter, sortBy };
  const { valid: presetSavedDecks } = applyDeckFilters(presetSavedDecksUnfiltered, deckFilterArgs);
  const { valid: filteredValid, drafts: filteredDrafts } = applyDeckFilters(savedDecks, {
    search,
    formatFilter,
    colorFilter,
    sortBy,
  });

  function handleSelectDeck(id: string) {
    setSearchParams({ deck: id });
  }

  function handleNewDeck() {
    setSearchParams({});
    clearDeck();
    setDeckName(DEFAULT_DECK_NAME);
    setView("editor");
  }

  async function handleTextImport(
    entries: ParsedDeckEntry[],
    name: string,
    onProgress: (fraction: number) => void,
  ) {
    const deckName = name.trim() || "Imported Deck";
    onProgress(0.05);
    const scryfallMap = await fetchCardCollection(entries.map((e) => ({ name: e.name })));
    onProgress(0.55);
    // Cards with name variants miss the exact lookup; retry them with fuzzy search.
    const stragglers = [
      ...new Set(entries.map((e) => e.name).filter((n) => !scryfallMap.get(n.toLowerCase()))),
    ];
    let resolved = 0;
    await Promise.all(
      stragglers.map((n) =>
        fetchCardByFuzzyName(n)
          .then((sc) => scryfallMap.set(n.toLowerCase(), sc))
          .catch((err) => console.warn(`[import] fuzzy "${n}" failed`, err))
          .finally(() => {
            resolved += 1;
            onProgress(0.55 + 0.35 * (resolved / stragglers.length));
          }),
      ),
    );
    onProgress(0.9);
    const cards: DeckCard[] = [];
    const sideboard: DeckCard[] = [];
    const maybeboard: DeckCard[] = [];
    const notFound: string[] = [];
    for (const { name: cardName, count, side, maybe } of entries) {
      const sc = scryfallMap.get(cardName.toLowerCase());
      if (!sc) {
        notFound.push(cardName);
        continue;
      }
      const target = side ? sideboard : maybe ? maybeboard : cards;
      for (let i = 0; i < count; i++) {
        const base = scryfallToDeckCard(sc);
        target.push({ ...base, identity: { ...base.identity, id: crypto.randomUUID() } });
      }
    }
    if (cards.length === 0 && sideboard.length === 0 && maybeboard.length === 0) {
      throw new Error("None of the cards could be found on Scryfall");
    }
    const id = addSavedDeck({
      name: deckName,
      format: inferImportedFormat(cards.map((c) => c.identity.name)),
      cards,
      sideboard,
      maybeboard,
      attractions: [],
      contraptions: [],
      schemes: [],
      planes: [],
    });
    onProgress(1);
    if (notFound.length > 0) {
      const shown = notFound.slice(0, 3).join(", ");
      const extra = notFound.length > 3 ? ` +${notFound.length - 3} more` : "";
      toast.warning(`Imported "${deckName}" — couldn't find: ${shown}${extra}`);
    } else {
      toast.success(`Imported "${deckName}"`);
    }
    console.log(
      `[import] built ${cards.length} main / ${sideboard.length} side / ${maybeboard.length} maybe, id=${id}, savedDeck.cards=${useDeckStore.getState().savedDecks.find((s) => s.id === id)?.deck.cards.length}`,
    );
    handleSelectDeck(id);
  }

  function handleBack() {
    if (isReadOnly) {
      useDeckStore.getState().clearDeck();
      if (readonlyEnteredInPage) {
        setReadonlyEnteredInPage(false);
        setSearchParams({});
        setView("list");
      } else {
        navigate(-1);
      }
      return;
    }
    if (hasUnsavedChanges) {
      setShowBackConfirm(true);
    } else {
      setSearchParams({});
      setView("list");
    }
  }

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
          <div className="px-4 py-3 border-b shrink-0 flex items-center">
            <h2 className="text-lg font-semibold flex-1">My Decks</h2>
          </div>

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
            <div className="p-4">
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
                    onDelete={() => handleDelete(s.id)}
                    onRename={() => startRename(s.id, s.deck.name)}
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

              {presetSavedDecks.length > 0 && (
                <div
                  className={cn(
                    "mt-4",
                    (filteredValid.length > 0 || filteredDrafts.length > 0) && "border-t pt-4",
                  )}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Preset Decks
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
              onBack={handleBack}
              previewSlot={previewSlot}
              setPreviewSlot={setPreviewSlot}
              previewCollapsed={previewCollapsed}
              onTogglePreview={togglePreview}
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
                  setSearchParams({});
                  setView("list");
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
