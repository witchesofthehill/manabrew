import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import { LimitedCompareDialog } from "@/components/limited/LimitedCompareDialog";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import { LimitedHoverPreviewPane } from "@/components/limited/LimitedHoverPreviewPane";
import { RaritySetSymbol } from "@/components/limited/RaritySetSymbol";
import { peekCard, useCard, useScryfallStore, type ScryfallEntry } from "@/stores/useScryfallStore";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useDeckStore } from "@/stores/useDeckStore";
import {
  BASIC_LAND_MANA,
  BASIC_LAND_NAMES,
  type BasicLandName,
  countManaPips,
  effectiveRarity,
  groupByName,
  groupByRarity,
  indexPool,
  isSynthBasic,
  type LimitedZone,
  makeBasicLand,
  type PoolEntry,
  RARITY_LABEL,
  refToDeckCard,
  resolveDeckCards,
  type UIRarity,
  unusedIndices,
  validateLimitedDeck,
} from "@/lib/limited.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { Deck, DeckFormat } from "@/protocol/deck";

type GroupMode = "rarity" | "name" | "cmc" | "color";

const ZONE_DROP_ID: Record<LimitedZone, string> = {
  pool: "limited-zone-pool",
  main: "limited-zone-main",
  sideboard: "limited-zone-sideboard",
};

type PoolColorChip = "W" | "U" | "B" | "R" | "G" | "C" | "M";
type PoolColorFilter = Set<PoolColorChip>;

const POOL_COLOR_CHIPS: Array<{
  key: PoolColorChip;
  symbol: string | null;
  fallback: string;
  label: string;
}> = [
  { key: "W", symbol: "W", fallback: "W", label: "White" },
  { key: "U", symbol: "U", fallback: "U", label: "Blue" },
  { key: "B", symbol: "B", fallback: "B", label: "Black" },
  { key: "R", symbol: "R", fallback: "R", label: "Red" },
  { key: "G", symbol: "G", fallback: "G", label: "Green" },
  { key: "C", symbol: "C", fallback: "C", label: "Colourless" },
  { key: "M", symbol: null, fallback: "★", label: "Multicolour" },
];

function passesColorFilter(
  card: DraftCard,
  filter: PoolColorFilter,
  cache: Record<string, ScryfallEntry>,
): boolean {
  if (filter.size === 0) return true;
  const scry = peekCard(cache, {
    name: card.name,
    setCode: card.setCode,
    cardNumber: card.cardNumber,
  });
  const colors = (scry?.colors ?? []).map((c) => c.toUpperCase());
  if (filter.has("M") && colors.length >= 2) return true;
  if (filter.has("C") && colors.length === 0) return true;
  return colors.some((c) => filter.has(c as PoolColorChip));
}

export interface LimitedDeckBuilderProps {
  pool: DraftCard[];
  initialMain?: DraftCard[];
  initialSideboard?: DraftCard[];
  targetMainSize?: number;
  defaultDeckName?: string;
  format?: DeckFormat;
  requireCompleteToSave?: boolean;
  onChange?: (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => void;
  confirmLabel?: string;
  onConfirm?: (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => void;
  onSaved?: (deckName: string) => void;
}

export default function LimitedDeckBuilder({
  pool,
  initialMain,
  initialSideboard,
  targetMainSize = 40,
  defaultDeckName = "Limited Deck",
  format = "draft",
  requireCompleteToSave = false,
  onChange,
  confirmLabel = "Save Deck",
  onConfirm,
  onSaved,
}: LimitedDeckBuilderProps) {
  const [extraBasics, setExtraBasics] = useState<DraftCard[]>([]);
  const fullPool = useMemo(() => [...pool, ...extraBasics], [pool, extraBasics]);
  const entries = useMemo(() => indexPool(fullPool), [fullPool]);
  const scryfallCache = useScryfallStore((s) => s.cards);

  const [main, setMain] = useState<number[]>(() => matchInitial(fullPool, initialMain ?? []));
  const [sideboard, setSideboard] = useState<number[]>(() =>
    matchInitial(fullPool, initialSideboard ?? []),
  );
  const [groupMode, setGroupMode] = useState<GroupMode>("rarity");
  const [poolColorFilter, setPoolColorFilter] = useState<PoolColorFilter>(() => new Set());

  const togglePoolColor = useCallback((key: PoolColorChip) => {
    setPoolColorFilter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const resetPoolColors = useCallback(() => setPoolColorFilter(new Set()), []);

  const [activeDrag, setActiveDrag] = useState<{ index: number; card: DraftCard } | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [saveDeckName, setSaveDeckName] = useState(defaultDeckName);

  useEffect(() => {
    onChange?.({
      main: main.map((i) => fullPool[i]).filter(Boolean),
      sideboard: sideboard.map((i) => fullPool[i]).filter(Boolean),
    });
  }, [main, sideboard, fullPool, onChange]);

  const unused = useMemo(
    () => unusedIndices(fullPool.length, main, sideboard),
    [fullPool.length, main, sideboard],
  );

  const validationIssues = useMemo(() => {
    const mainCards = main.map((i) => fullPool[i]).filter(Boolean);
    const sideboardCards = sideboard.map((i) => fullPool[i]).filter(Boolean);
    return validateLimitedDeck(mainCards, sideboardCards, targetMainSize);
  }, [main, sideboard, fullPool, targetMainSize]);

  const moveTo = useCallback((idx: number, target: LimitedZone) => {
    setMain((m) => (target === "main" ? addUnique(m, idx) : m.filter((i) => i !== idx)));
    setSideboard((s) => (target === "sideboard" ? addUnique(s, idx) : s.filter((i) => i !== idx)));
  }, []);

  const cycleZone = useCallback(
    (idx: number, currentZone: LimitedZone) => {
      const next: LimitedZone =
        currentZone === "pool" ? "main" : currentZone === "main" ? "sideboard" : "pool";
      moveTo(idx, next);
    },
    [moveTo],
  );

  const addBasic = useCallback(
    (name: BasicLandName) => {
      setExtraBasics((b) => {
        const idx = fullPool.length;
        const next = [...b, makeBasicLand(name, b.length)];
        setMain((m) => [...m, idx]);
        return next;
      });
    },
    [fullPool.length],
  );

  const fixManaBase = useCallback(() => {
    const cache = useScryfallStore.getState().cards;
    const mainCards = main.map((i) => fullPool[i]).filter(Boolean);
    const sideboardCards = sideboard.map((i) => fullPool[i]).filter(Boolean);
    const basicNames = new Set<string>(BASIC_LAND_NAMES);
    const nonLand = mainCards.filter(
      (c) =>
        !basicNames.has(c.name) &&
        effectiveRarity(
          peekCard(cache, {
            name: c.name,
            setCode: c.setCode,
            cardNumber: c.cardNumber,
          }),
        ) !== "land",
    );
    const targetLands = Math.max(0, targetMainSize - nonLand.length);
    if (targetLands === 0) {
      toast.info("No room for basics — main deck is already at target size.");
      return;
    }

    const pips: Record<BasicLandName, number> = {
      Plains: 0,
      Island: 0,
      Swamp: 0,
      Mountain: 0,
      Forest: 0,
    };
    const colorToBasic: Record<string, BasicLandName> = {
      W: "Plains",
      U: "Island",
      B: "Swamp",
      R: "Mountain",
      G: "Forest",
    };
    const cardsForPipCount = nonLand.concat(sideboardCards);
    for (const card of cardsForPipCount) {
      const cost = peekCard(cache, {
        name: card.name,
        setCode: card.setCode,
        cardNumber: card.cardNumber,
      })?.mana_cost;
      if (!cost) continue;
      for (const letter of ["W", "U", "B", "R", "G"]) {
        pips[colorToBasic[letter]] += countManaPips(cost, letter);
      }
    }

    const totalPips = (Object.values(pips) as number[]).reduce((a, b) => a + b, 0);
    let allocation: Record<BasicLandName, number>;
    if (totalPips === 0) {
      // No castable spells / unknown costs — split evenly across
      // the player's drafted colours, falling back to all five.
      const usedColors = (Object.entries(pips) as Array<[BasicLandName, number]>)
        .filter(([, n]) => n > 0)
        .map(([k]) => k);
      const colors =
        usedColors.length > 0 ? usedColors : (BASIC_LAND_NAMES as readonly BasicLandName[]).slice();
      const each = Math.floor(targetLands / colors.length);
      const remainder = targetLands - each * colors.length;
      allocation = { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 };
      colors.forEach((c, i) => {
        allocation[c] = each + (i < remainder ? 1 : 0);
      });
    } else {
      // Largest-remainder rounding so the totals add up exactly.
      const raw = (Object.entries(pips) as Array<[BasicLandName, number]>).map(([k, n]) => ({
        key: k,
        ratio: (n / totalPips) * targetLands,
      }));
      const floors = raw.map((r) => ({
        key: r.key,
        count: Math.floor(r.ratio),
        frac: r.ratio - Math.floor(r.ratio),
      }));
      let leftover = targetLands - floors.reduce((acc, f) => acc + f.count, 0);
      floors.sort((a, b) => b.frac - a.frac);
      for (let i = 0; i < floors.length && leftover > 0; i++) {
        floors[i].count += 1;
        leftover -= 1;
      }
      allocation = { Plains: 0, Island: 0, Swamp: 0, Mountain: 0, Forest: 0 };
      for (const f of floors) {
        allocation[f.key as BasicLandName] = f.count;
      }
    }

    // Strip existing user-added basics from main + sideboard so we
    // don't double-count, then push fresh ones.
    setMain((m) => m.filter((idx) => !basicNames.has(fullPool[idx]?.name ?? "")));
    setSideboard((s) => s.filter((idx) => !basicNames.has(fullPool[idx]?.name ?? "")));
    setExtraBasics(() => {
      const fresh: DraftCard[] = [];
      const newMainIndices: number[] = [];
      let nextIndex = pool.length; // basics live above the original pool size
      for (const name of BASIC_LAND_NAMES) {
        const count = allocation[name];
        for (let i = 0; i < count; i++) {
          fresh.push(makeBasicLand(name, fresh.length));
          newMainIndices.push(nextIndex++);
        }
      }
      setMain((m) => [...m, ...newMainIndices]);
      return fresh;
    });
    toast.success(
      `Mana base reset · ${(Object.entries(allocation) as Array<[string, number]>)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${n} ${k.slice(0, 1)}`)
        .join(" · ")}`,
    );
  }, [fullPool, main, sideboard, pool, targetMainSize]);

  const handleConfirm = () => {
    onConfirm?.({
      main: main.map((i) => fullPool[i]).filter(Boolean),
      sideboard: sideboard.map((i) => fullPool[i]).filter(Boolean),
    });
  };

  const hasSuggestion = (initialMain && initialMain.length > 0) || false;
  const resetToSuggested = useCallback(() => {
    setMain(matchInitial(fullPool, initialMain ?? []));
    setSideboard(matchInitial(fullPool, initialSideboard ?? []));
    setExtraBasics([]);
  }, [fullPool, initialMain, initialSideboard]);

  const preview = useCardPreview();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as { index: number } | undefined;
    if (!data) return;
    const card = fullPool[data.index];
    if (card) setActiveDrag({ index: data.index, card });
    preview.dismiss();
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const data = event.active.data.current as { index: number; fromZone: LimitedZone } | undefined;
    const overId = event.over?.id;
    if (!data || !overId) return;
    let target: LimitedZone | null = null;
    if (overId === ZONE_DROP_ID.pool) target = "pool";
    else if (overId === ZONE_DROP_ID.main) target = "main";
    else if (overId === ZONE_DROP_ID.sideboard) target = "sideboard";
    if (!target || target === data.fromZone) return;
    moveTo(data.index, target);
  };

  const loadDeck = useDeckStore((s) => s.loadDeck);
  const saveCurrentDeck = useDeckStore((s) => s.saveCurrentDeck);

  const openSaveDialog = () => {
    setSaveDeckName(defaultDeckName);
    setSaveDialogOpen(true);
  };

  const handleSaveToMyDecks = async () => {
    const name = saveDeckName.trim();
    if (!name) {
      toast.error("Deck name cannot be empty.");
      return;
    }
    const mainCards = main.map((i) => fullPool[i]).filter(Boolean);
    const sideboardCards = sideboard.map((i) => fullPool[i]).filter(Boolean);
    if (mainCards.length === 0 && sideboardCards.length === 0) {
      toast.error("Add some cards before saving.");
      return;
    }
    if (requireCompleteToSave && mainCards.length < targetMainSize) {
      toast.error(
        `Main deck needs ${targetMainSize - mainCards.length} more card${
          targetMainSize - mainCards.length === 1 ? "" : "s"
        }.`,
      );
      return;
    }
    if (validationIssues.some((i) => i.kind === "too_many_copies")) {
      toast.error("Deck violates the 4-of rule. Remove duplicates before saving.");
      return;
    }
    const leftoverCards = unused
      .map((i) => fullPool[i])
      .filter((c): c is DraftCard => Boolean(c) && !isSynthBasic(c));

    const [resolvedMain, resolvedSide, resolvedMaybe] = await Promise.all([
      resolveDeckCards(mainCards),
      resolveDeckCards(sideboardCards),
      resolveDeckCards(leftoverCards),
    ]);
    const deck: Deck = {
      name,
      format,
      cards: resolvedMain,
      sideboard: resolvedSide,
      draft: resolvedMain.length < targetMainSize,
    };
    if (resolvedMaybe.length > 0) deck.maybeboard = resolvedMaybe;
    loadDeck(deck);
    saveCurrentDeck();
    setSaveDialogOpen(false);
    toast.success(
      resolvedMaybe.length > 0
        ? `Saved "${name}" to My Decks (${resolvedMaybe.length} card${
            resolvedMaybe.length === 1 ? "" : "s"
          } parked in maybeboard).`
        : `Saved "${name}" to My Decks.`,
    );
    onSaved?.(name);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      <div className="flex h-full flex-col gap-3 overflow-hidden">
        <Toolbar
          groupMode={groupMode}
          onGroupModeChange={setGroupMode}
          colorFilter={poolColorFilter}
          onColorFilterToggle={togglePoolColor}
          onColorFilterReset={resetPoolColors}
          mainCount={main.length}
          sideboardCount={sideboard.length}
          targetMainSize={targetMainSize}
          unusedCount={unused.length}
          onAddBasic={addBasic}
          onFixManaBase={fixManaBase}
          onReset={hasSuggestion ? resetToSuggested : undefined}
          onCompare={() => setCompareDialogOpen(true)}
          confirmLabel={confirmLabel}
          onConfirm={onConfirm ? handleConfirm : undefined}
          onSaveToMyDecks={openSaveDialog}
        />

        <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden md:grid-cols-2 md:grid-rows-2 lg:grid-cols-[1.4fr_1fr_0.7fr_minmax(0,326px)] lg:grid-rows-1">
          <Zone
            className="md:row-span-2 lg:row-span-1"
            title={`Pool (${unused.length})`}
            entries={pickEntries(entries, unused).filter((e) =>
              passesColorFilter(e.card, poolColorFilter, scryfallCache),
            )}
            groupMode={groupMode}
            zone="pool"
            emptyMessage={
              poolColorFilter.size > 0
                ? "No cards match the colour filter."
                : "Every card is in the deck or sideboard."
            }
            onCardClick={(idx) => cycleZone(idx, "pool")}
            preview={preview}
          />
          <Zone
            title={`Main (${main.length}/${targetMainSize})`}
            entries={pickEntries(entries, main)}
            groupMode={groupMode}
            zone="main"
            emptyMessage="Drag cards here, or click pool cards to add."
            highlight={
              main.length === targetMainSize
                ? "border-primary"
                : main.length > targetMainSize
                  ? "border-destructive"
                  : "border-border/70"
            }
            warnOnDrop={
              activeDrag && main.length >= targetMainSize && !main.includes(activeDrag.index)
                ? `Main full (${targetMainSize})`
                : null
            }
            onCardClick={(idx) => cycleZone(idx, "main")}
            preview={preview}
          />
          <Zone
            title={`Sideboard (${sideboard.length})`}
            entries={pickEntries(entries, sideboard)}
            groupMode={groupMode}
            zone="sideboard"
            emptyMessage="Cards parked here aren't in the main deck."
            onCardClick={(idx) => cycleZone(idx, "sideboard")}
            preview={preview}
          />
          <div className="hidden min-h-0 flex-col gap-3 lg:flex">
            <LimitedHoverPreviewPane preview={preview} />
            {validationIssues.length > 0 && (
              <ul className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-[11px] text-yellow-100">
                {validationIssues.map((issue) => (
                  <li key={`${issue.kind}-${issue.message}`}>⚠ {issue.message}</li>
                ))}
              </ul>
            )}
            <LimitedDeckStats
              cards={main.map((i) => fullPool[i]).filter(Boolean)}
              className="flex-1 overflow-y-auto"
            />
          </div>
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag && <DragPreview card={activeDrag.card} index={activeDrag.index} />}
      </DragOverlay>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save to My Decks</DialogTitle>
            <DialogDescription>
              Saved decks live in your browser and appear in the Decks section.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="limited-save-name">Deck name</Label>
            <Input
              id="limited-save-name"
              value={saveDeckName}
              onChange={(e) => setSaveDeckName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSaveToMyDecks();
                }
              }}
            />
            <p className="text-xs text-muted-foreground">
              Main: {main.length} · Sideboard: {sideboard.length}
            </p>
            {main.length < targetMainSize && (
              <p
                className={cn(
                  "rounded border p-2 text-xs",
                  requireCompleteToSave
                    ? "border-destructive/60 bg-destructive/10 text-destructive"
                    : "border-yellow-500/40 bg-yellow-500/10 text-yellow-100",
                )}
              >
                {requireCompleteToSave ? "✗" : "⚠"} Main deck is {targetMainSize - main.length} card
                {targetMainSize - main.length === 1 ? "" : "s"} short of the {targetMainSize}-card
                target.
                {requireCompleteToSave
                  ? " Saving is blocked until the deck is legal."
                  : " Saving will flag the deck as a draft."}
              </p>
            )}
            {validationIssues.some((i) => i.kind === "too_many_copies") && (
              <p className="rounded border border-destructive/60 bg-destructive/10 p-2 text-xs text-destructive">
                ✗ Deck violates the 4-of rule. Remove duplicates before saving.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveToMyDecks}
              disabled={
                (requireCompleteToSave && main.length < targetMainSize) ||
                validationIssues.some((i) => i.kind === "too_many_copies")
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LimitedCompareDialog
        current={main.map((i) => fullPool[i]).filter(Boolean)}
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
      />
    </DndContext>
  );
}

interface ToolbarProps {
  groupMode: GroupMode;
  onGroupModeChange: (m: GroupMode) => void;
  colorFilter: PoolColorFilter;
  onColorFilterToggle: (key: PoolColorChip) => void;
  onColorFilterReset: () => void;
  mainCount: number;
  sideboardCount: number;
  targetMainSize: number;
  unusedCount: number;
  onAddBasic: (name: BasicLandName) => void;
  onFixManaBase?: () => void;
  onReset?: () => void;
  onCompare?: () => void;
  confirmLabel: string;
  onConfirm?: () => void;
  onSaveToMyDecks: () => void;
}

function Toolbar({
  groupMode,
  onGroupModeChange,
  colorFilter,
  onColorFilterToggle,
  onColorFilterReset,
  mainCount,
  sideboardCount,
  targetMainSize,
  unusedCount,
  onAddBasic,
  onFixManaBase,
  onReset,
  onCompare,
  confirmLabel,
  onConfirm,
  onSaveToMyDecks,
}: ToolbarProps) {
  const mainShortBy = targetMainSize - mainCount;
  const filterActive = colorFilter.size > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/70 bg-card/40 p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Group by</span>
        {(["rarity", "name", "cmc", "color"] as GroupMode[]).map((m) => (
          <Button
            key={m}
            size="sm"
            variant={groupMode === m ? "secondary" : "ghost"}
            onClick={() => onGroupModeChange(m)}
            className="h-7 px-2 text-xs capitalize"
          >
            {m}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Filter:</span>
        {POOL_COLOR_CHIPS.map((chip) => (
          <Button
            key={chip.key}
            size="sm"
            variant={colorFilter.has(chip.key) ? "secondary" : "outline"}
            onClick={() => onColorFilterToggle(chip.key)}
            title={chip.label}
            aria-label={chip.label}
            className="h-7 px-2"
          >
            {chip.symbol ? (
              <ManaSymbols cost={`{${chip.symbol}}`} size="sm" />
            ) : (
              <span className="text-[10px] font-bold">{chip.fallback}</span>
            )}
          </Button>
        ))}
        {filterActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onColorFilterReset}
            className="h-7 px-2 text-[10px] text-muted-foreground"
          >
            Clear
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1">
        <span className="text-muted-foreground">Add basic:</span>
        {BASIC_LAND_NAMES.map((name) => (
          <Button
            key={name}
            size="sm"
            variant="outline"
            onClick={() => onAddBasic(name)}
            title={name}
            aria-label={`Add ${name}`}
            className="h-7 px-2"
          >
            <ManaSymbols cost={`{${BASIC_LAND_MANA[name]}}`} size="sm" />
          </Button>
        ))}
        {onFixManaBase && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onFixManaBase}
            className="h-7 px-2 text-xs"
            title="Auto-fill basics proportional to your colour pips"
          >
            Fix mana base
          </Button>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3 text-xs">
        <span className={mainShortBy === 0 ? "text-primary" : "text-muted-foreground"}>
          Main {mainCount}/{targetMainSize}
        </span>
        <span className="text-muted-foreground">SB {sideboardCount}</span>
        <span className="text-muted-foreground">Pool {unusedCount}</span>
        {onReset && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            className="h-7 px-2 text-xs"
            title="Reset main + sideboard to the suggested deck"
          >
            Reset
          </Button>
        )}
        {onCompare && (
          <Button
            size="sm"
            variant="ghost"
            onClick={onCompare}
            className="h-7 px-2 text-xs"
            title="Compare with a saved deck"
          >
            Compare
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onSaveToMyDecks}>
          Save to My Decks
        </Button>
        {onConfirm && (
          <Button onClick={onConfirm} disabled={mainCount < targetMainSize}>
            {confirmLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

interface ZoneProps {
  title: string;
  entries: PoolEntry[];
  groupMode: GroupMode;
  zone: LimitedZone;
  emptyMessage: string;
  highlight?: string;
  warnOnDrop?: string | null;
  onCardClick: (idx: number) => void;
  preview: ReturnType<typeof useCardPreview>;
  className?: string;
}

function Zone({
  title,
  entries,
  groupMode,
  zone,
  emptyMessage,
  highlight,
  warnOnDrop,
  onCardClick,
  preview,
  className,
}: ZoneProps) {
  const cache = useScryfallStore((s) => s.cards);
  const groups = useMemo(() => {
    switch (groupMode) {
      case "rarity":
        return renderByRarity(entries, cache);
      case "name":
        return renderByName(entries);
      case "cmc":
        return renderByCmc(entries, cache);
      case "color":
        return renderByColor(entries, cache);
    }
  }, [entries, groupMode, cache]);
  const { setNodeRef, isOver } = useDroppable({ id: ZONE_DROP_ID[zone] });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-md border bg-card/30 transition-colors",
        highlight ?? "border-border/70",
        isOver && (warnOnDrop ? "border-destructive bg-destructive/10" : "bg-primary/5"),
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-border/40 px-3 py-2 text-sm font-semibold">
        <span>{title}</span>
        {isOver && warnOnDrop && (
          <span className="rounded bg-destructive/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-destructive">
            {warnOnDrop}
          </span>
        )}
      </header>
      <div className="flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{emptyMessage}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <GroupSection
                key={g.label}
                label={g.label}
                count={g.entries.length}
                icon={
                  g.rarity ? (
                    <RaritySetSymbol
                      rarity={g.rarity}
                      setCode={g.entries[0]?.card.setCode}
                      className="h-3 w-3"
                    />
                  ) : null
                }
              >
                <CardGrid
                  entries={g.entries}
                  zone={zone}
                  onCardClick={onCardClick}
                  preview={preview}
                />
              </GroupSection>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function GroupSection({
  label,
  count,
  icon,
  children,
}: {
  label: string;
  count: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span>{label}</span>
        <span className="text-muted-foreground/60">({count})</span>
      </h3>
      {children}
    </div>
  );
}

function CardGrid({
  entries,
  zone,
  onCardClick,
  preview,
}: {
  entries: PoolEntry[];
  zone: LimitedZone;
  onCardClick: (idx: number) => void;
  preview: ReturnType<typeof useCardPreview>;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4">
      {entries.map((e) => (
        <DraggableTile
          key={e.index}
          entry={e}
          zone={zone}
          onCardClick={onCardClick}
          preview={preview}
        />
      ))}
    </div>
  );
}

function DraggableTile({
  entry,
  zone,
  onCardClick,
  preview,
}: {
  entry: PoolEntry;
  zone: LimitedZone;
  onCardClick: (idx: number) => void;
  preview: ReturnType<typeof useCardPreview>;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tile-${entry.index}`,
    data: { index: entry.index, fromZone: zone },
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "touch-none cursor-grab rounded-lg active:cursor-grabbing",
        isDragging && "opacity-30 ring-2 ring-selection/50",
      )}
    >
      <DraftCardTile
        card={entry.card}
        index={entry.index}
        onClick={() => onCardClick(entry.index)}
        preview={preview}
      />
    </div>
  );
}

function DragPreview({ card, index }: { card: DraftCard; index: number }) {
  const scry = useCard({
    name: card.name,
    setCode: card.setCode,
    cardNumber: card.cardNumber,
  });
  if (!scry) {
    return (
      <div className="pointer-events-none w-24 rotate-3 rounded-lg opacity-90 shadow-2xl ring-2 ring-selection">
        <div className="aspect-[5/7] w-full animate-pulse rounded-lg border border-border/50 bg-muted/40" />
      </div>
    );
  }
  return (
    <div className="pointer-events-none w-24 rotate-3 rounded-lg opacity-90 shadow-2xl ring-2 ring-selection">
      <CardThumbnail card={refToDeckCard(card, scry, index)} />
    </div>
  );
}

function pickEntries(all: PoolEntry[], indices: number[]): PoolEntry[] {
  return indices.map((i) => all[i]).filter((e): e is PoolEntry => Boolean(e));
}

function addUnique(arr: number[], v: number): number[] {
  return arr.includes(v) ? arr : [...arr, v];
}

interface RenderedGroup {
  label: string;
  entries: PoolEntry[];
  rarity?: UIRarity;
}

function renderByRarity(
  entries: PoolEntry[],
  cache: Record<string, ScryfallEntry>,
): RenderedGroup[] {
  return groupByRarity(entries, (ref) =>
    effectiveRarity(
      peekCard(cache, {
        name: ref.name,
        setCode: ref.setCode,
        cardNumber: ref.cardNumber,
      }),
    ),
  ).map((g) => ({
    label: RARITY_LABEL[g.rarity],
    entries: g.entries,
    rarity: g.rarity,
  }));
}

function renderByName(entries: PoolEntry[]): RenderedGroup[] {
  return groupByName(entries).map((g) => ({ label: g.name, entries: g.entries }));
}

function renderByColor(
  entries: PoolEntry[],
  cache: Record<string, ScryfallEntry>,
): RenderedGroup[] {
  const buckets: Record<string, PoolEntry[]> = {
    White: [],
    Blue: [],
    Black: [],
    Red: [],
    Green: [],
    Multicolour: [],
    Colourless: [],
    Lands: [],
  };
  const colorLabel: Record<string, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
  };
  for (const entry of entries) {
    const scry = peekCard(cache, {
      name: entry.card.name,
      setCode: entry.card.setCode,
      cardNumber: entry.card.cardNumber,
    });
    if (effectiveRarity(scry) === "land") {
      buckets.Lands.push(entry);
      continue;
    }
    const cs = (scry?.colors ?? []).map((c) => c.toUpperCase());
    if (cs.length === 0) buckets.Colourless.push(entry);
    else if (cs.length >= 2) buckets.Multicolour.push(entry);
    else buckets[colorLabel[cs[0]] ?? "Colourless"].push(entry);
  }
  return Object.entries(buckets)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, entries: list }));
}

function renderByCmc(entries: PoolEntry[], cache: Record<string, ScryfallEntry>): RenderedGroup[] {
  const buckets: PoolEntry[][] = [[], [], [], [], [], [], [], []]; // 0..6, 7 = unknown
  for (const e of entries) {
    const scry = peekCard(cache, {
      name: e.card.name,
      setCode: e.card.setCode,
      cardNumber: e.card.cardNumber,
    });
    if (effectiveRarity(scry) === "land") {
      buckets[7].push(e);
      continue;
    }
    const cmc = typeof scry?.cmc === "number" ? scry.cmc : null;
    if (cmc == null) {
      buckets[7].push(e);
      continue;
    }
    const idx = Math.max(0, Math.min(6, Math.round(cmc)));
    buckets[idx].push(e);
  }
  const labels = ["0", "1", "2", "3", "4", "5", "6+", "Land / Unknown"];
  return buckets
    .map((list, i) => ({ label: labels[i], entries: list }))
    .filter((g) => g.entries.length > 0);
}

function matchInitial(pool: DraftCard[], initial: DraftCard[]): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const want of initial) {
    let foundIdx = -1;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const p = pool[i];
      if (p.name === want.name && p.setCode === want.setCode && p.cardNumber === want.cardNumber) {
        foundIdx = i;
        break;
      }
    }
    if (foundIdx === -1) {
      for (let i = 0; i < pool.length; i++) {
        if (used.has(i)) continue;
        if (pool[i].name === want.name) {
          foundIdx = i;
          break;
        }
      }
    }
    if (foundIdx !== -1) {
      used.add(foundIdx);
      out.push(foundIdx);
    }
  }
  return out;
}
