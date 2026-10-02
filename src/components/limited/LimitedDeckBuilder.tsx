import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LimitedBuildBoard } from "@/components/limited/LimitedBuildBoard";
import { LimitedBuildFilters, type BuildFilters } from "@/components/limited/LimitedBuildFilters";
import { buildDeck, useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import type { BuildZone } from "@/components/limited/useLimitedBuildStore";
import { LimitedBuildActions } from "@/components/limited/LimitedBuildActions";
import { LimitedBuildSelection } from "@/components/limited/LimitedBuildSelection";
import { useLimitedBuildCards } from "@/components/limited/useLimitedBuildCards";
import { useLimitedBoardLayout } from "@/components/limited/useLimitedBoardLayout";
import { LimitedBuildUtilities } from "@/components/limited/LimitedBuildUtilities";
import { useIsDesktop, useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import type { DraftCard } from "@/types/limited";
import type { DeckFormat } from "@/protocol/deck";
export interface LimitedDeckBuilderProps {
  sessionKey: string;
  pool: DraftCard[];
  initialMain?: DraftCard[];
  initialSideboard?: DraftCard[];
  suggestedMain?: DraftCard[];
  targetMainSize?: number;
  defaultDeckName?: string;
  format?: DeckFormat;
  requireCompleteToSave?: boolean;
  showUtilities?: boolean;
  onChange?: (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => void;
  confirmLabel?: string;
  onConfirm?: (deck: { main: DraftCard[]; sideboard: DraftCard[] }) => void;
  onSaved?: (deckName: string) => void;
}
export default function LimitedDeckBuilder({
  sessionKey,
  pool,
  initialMain,
  initialSideboard,
  suggestedMain,
  targetMainSize = 40,
  defaultDeckName = "Limited Deck",
  format = "draft",
  requireCompleteToSave = false,
  showUtilities = true,
  onChange,
  confirmLabel = "Save Deck",
  onConfirm,
  onSaved,
}: LimitedDeckBuilderProps) {
  const session = useLimitedBuildStore((state) => state.sessions[sessionKey]);
  const [filters, setFilters] = useState<BuildFilters>({ search: "", colors: [], type: "all" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { mobileZone, visibleZones, expandedZone, showZone, toggleZone } = useLimitedBoardLayout();
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const isDesktop = useIsDesktop();
  const shortTouch = shortScreen && isTouch;
  const acquired = session?.pool;
  const allocation = session?.allocation;
  const basics = allocation?.basics;
  const group = session?.group;
  const initialized = !!session;
  const changeRef = useRef(onChange);
  const builderRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    useLimitedBuildStore.getState().sync(sessionKey, pool, initialMain, initialSideboard);
  }, [sessionKey, pool, initialMain, initialSideboard]);
  const cards = useMemo(
    () => (acquired && basics ? [...acquired, ...basics] : []),
    [acquired, basics],
  );
  const acquiredIds = useMemo(() => cards.map((card) => card.id), [cards]);
  const deck = useMemo(
    () =>
      acquired && allocation
        ? buildDeck({ pool: acquired, allocation })
        : { main: [], sideboard: [] },
    [acquired, allocation],
  );
  useEffect(() => {
    if (initialized) changeRef.current?.(deck);
  }, [deck, initialized]);
  const filtered = useLimitedBuildCards(cards, filters, group);
  const select = useCallback((card: DraftCard, additive: boolean) => {
    setSelectedIds((current) =>
      additive
        ? current.includes(card.id)
          ? current.filter((id) => id !== card.id)
          : [...current, card.id]
        : [card.id],
    );
  }, []);
  const move = useCallback(
    (ids: string[], zone: BuildZone) => {
      useLimitedBuildStore.getState().move(sessionKey, ids, zone);
    },
    [sessionKey],
  );
  const drop = useCallback(
    (card: DraftCard, x: number, y: number) => {
      const root = builderRef.current;
      const destination = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-limited-zone]");
      if (
        !root ||
        !destination ||
        !root.contains(destination) ||
        destination.closest("[data-limited-builder]") !== root ||
        root.dataset.limitedBuilder !== sessionKey
      )
        return;
      const zone = destination.dataset.limitedZone;
      if (zone === "main" || zone === "pool" || zone === "sideboard" || zone === "maybe") {
        move(selectedIds.includes(card.id) ? selectedIds : [card.id], zone);
        if (!isDesktop || shortTouch) showZone(zone);
      }
    },
    [move, selectedIds, sessionKey, showZone, isDesktop, shortTouch],
  );
  if (!session)
    return (
      <p role="status" className="p-3 text-sm text-muted-foreground">
        Restoring your build...
      </p>
    );
  const mainIds = new Set(session.allocation.mainIds);
  const sideboardIds = new Set(session.allocation.sideboardIds);
  const maybeIds = new Set(session.allocation.maybeIds);
  const availableSelection = selectedIds.filter((id) => cards.some((card) => card.id === id));
  const zones = [
    {
      id: "pool",
      title: "Pool",
      cards: filtered.filter(
        (card) => !mainIds.has(card.id) && !sideboardIds.has(card.id) && !maybeIds.has(card.id),
      ),
      total: cards.filter(
        (card) => !mainIds.has(card.id) && !sideboardIds.has(card.id) && !maybeIds.has(card.id),
      ).length,
    },
    {
      id: "main",
      title: "Mainboard",
      cards: filtered.filter((card) => mainIds.has(card.id)),
      total: deck.main.length,
    },
    {
      id: "sideboard",
      title: "Sideboard",
      cards: filtered.filter((card) => sideboardIds.has(card.id)),
      total: cards.filter((card) => sideboardIds.has(card.id)).length,
    },
    {
      id: "maybe",
      title: "Maybeboard",
      cards: filtered.filter((card) => maybeIds.has(card.id)),
      total: cards.filter((card) => maybeIds.has(card.id)).length,
    },
  ] as const;
  return (
    <div
      ref={builderRef}
      data-limited-table
      data-limited-builder={sessionKey}
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden"
      onKeyDown={(event) => {
        if (
          !builderRef.current?.contains(event.target as Node) ||
          (event.target instanceof HTMLElement &&
            event.target.closest("input, textarea, [contenteditable=true]"))
        )
          return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
          event.preventDefault();
          setSelectedIds(
            zones
              .filter((zone) =>
                isDesktop && !shortTouch
                  ? visibleZones.includes(zone.id) && (!expandedZone || expandedZone === zone.id)
                  : zone.id === mobileZone,
              )
              .flatMap((zone) => zone.cards.map((card) => card.id)),
          );
        }
        if (event.key === "Escape") setSelectedIds([]);
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <LimitedBuildActions
          sessionKey={sessionKey}
          session={session}
          deck={deck}
          shortTouch={shortTouch}
          suggestedMain={suggestedMain ?? initialMain}
          suggestedSideboard={suggestedMain ? undefined : initialSideboard}
          defaultDeckName={defaultDeckName}
          targetMainSize={targetMainSize}
          requireCompleteToSave={requireCompleteToSave}
          format={format}
          onSaved={onSaved}
          onConfirm={onConfirm}
          confirmLabel={confirmLabel}
        />
        <LimitedBuildFilters
          filters={filters}
          onChange={setFilters}
          session={session}
          presentation={showUtilities ? "toolbar" : "dialog"}
          onPreferences={(prefs) => useLimitedBuildStore.getState().preferences(sessionKey, prefs)}
        />
        {availableSelection.length > 0 && (
          <LimitedBuildSelection
            availableSelection={availableSelection}
            move={move}
            setSelectedIds={setSelectedIds}
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <LimitedBuildBoard
          zones={zones}
          mobileZone={mobileZone}
          onZoneChange={showZone}
          compact={!isDesktop || shortTouch}
          visibleZones={visibleZones}
          expandedZone={expandedZone}
          onToggleZone={toggleZone}
          acquiredIds={acquiredIds}
          selectedIds={availableSelection}
          onSelect={select}
          onSelectMany={setSelectedIds}
          onMove={move}
          onDrop={drop}
          group={session.group}
          cardSize={session.cardSize}
          mode={session.mode}
        />
        {showUtilities && (
          <LimitedBuildUtilities
            deck={deck}
            cardSize={session.cardSize}
            activeManaValue={filters.manaValue ?? null}
            onManaValueChange={(manaValue) => setFilters((current) => ({ ...current, manaValue }))}
          />
        )}
      </div>
    </div>
  );
}
