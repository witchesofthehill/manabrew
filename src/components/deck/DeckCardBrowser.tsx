import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { CardDetailModal } from "@/components/editor/CardDetailModal";
import {
  CardCountBadge,
  CardThumbnail,
  SectionHeader,
} from "@/components/editor/deckEditor.primitives";
import {
  DeckCardBrowserFilters,
  type BrowserCardTypeFilter,
  type BrowserManaValueFilter,
  type BrowserZoneFilter,
} from "@/components/deck/DeckCardBrowserFilters";
import {
  CARD_WIDTH_MAP,
  computeGroupedSections,
  computeGroupedStackColumns,
  groupCards,
  parseFilterTerms,
  type CardGroup,
  type GroupByMode,
  type ViewMode,
} from "@/components/editor/deckBuilder.utils";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { cn } from "@/lib/utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { CardDto } from "@/protocol/game";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";

function matchesManaValue(card: DeckCard, filter: BrowserManaValueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "7+") return card.cmc >= 7;
  return Math.round(card.cmc) === Number(filter);
}

function matchesColorIdentity(card: DeckCard, colors: string[]): boolean {
  if (colors.length === 0) return true;
  return colors.some((color) =>
    color === "C" ? card.colorIdentity.length === 0 : card.colorIdentity.includes(color),
  );
}

function matchesCardType(card: DeckCard, cardType: BrowserCardTypeFilter): boolean {
  if (cardType === "all") return true;
  return card.types.some((type) => type.toLowerCase() === cardType);
}

function BrowserCardRow({
  group,
  onOpen,
  onPointerEnter,
  onPointerLeave,
}: {
  group: CardGroup;
  onOpen: (card: DeckCard) => void;
  onPointerEnter: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}) {
  const { card, count } = group;
  return (
    <button
      type="button"
      data-card-name={card.identity.name}
      className="flex w-full items-center gap-1 rounded px-1 py-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-10"
      onClick={() => onOpen(card)}
      onPointerEnter={(event) => onPointerEnter(card, event)}
      onPointerLeave={onPointerLeave}
    >
      <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">
        {count}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{card.identity.name}</span>
      {card.manaCost && <ManaSymbols cost={card.manaCost} size="sm" className="shrink-0" />}
      {card.power && card.toughness && (
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {card.power}/{card.toughness}
        </span>
      )}
    </button>
  );
}

function BrowserVisualCard({
  group,
  width,
  onOpen,
  onPointerEnter,
  onPointerLeave,
}: {
  group: CardGroup;
  width: number;
  onOpen: (card: DeckCard) => void;
  onPointerEnter: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}) {
  return (
    <button
      type="button"
      data-card-name={group.card.identity.name}
      className="group relative shrink-0 rounded-lg text-left transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:hover:translate-y-0"
      style={{ width }}
      onClick={() => onOpen(group.card)}
      onPointerEnter={(event) => onPointerEnter(group.card, event)}
      onPointerLeave={onPointerLeave}
    >
      <CardThumbnail
        card={group.card}
        imageSize={width <= 115 ? "small" : "normal"}
        loading="lazy"
      />
      <CardCountBadge count={group.count} />
    </button>
  );
}

function BrowserStackColumn({
  label,
  groups,
  width,
  onOpen,
  onPointerEnter,
  onPointerLeave,
}: {
  label: string;
  groups: CardGroup[];
  width: number;
  onOpen: (card: DeckCard) => void;
  onPointerEnter: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const cardHeight = Math.round(width * 1.4);
  const peek = Math.max(28, Math.round(cardHeight * 0.2));
  const spread = cardHeight - peek;
  const topFor = (index: number) =>
    index * peek + (hoveredIndex !== null && index > hoveredIndex ? spread : 0);
  const height = groups.length === 0 ? 0 : topFor(groups.length - 1) + Math.round(width * 1.4);
  const count = groups.reduce((total, group) => total + group.count, 0);

  return (
    <div className="shrink-0" style={{ width }}>
      <SectionHeader label={label} count={count} />
      <div className="relative transition-[height] duration-200" style={{ height }}>
        {groups.map((group, index) => (
          <button
            key={group.card.identity.name}
            type="button"
            data-card-name={group.card.identity.name}
            className="absolute left-0 rounded-lg text-left transition-[top,transform] duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            style={{ top: topFor(index), width, zIndex: index + 1 }}
            onClick={() => onOpen(group.card)}
            onPointerEnter={(event) => {
              setHoveredIndex(index);
              onPointerEnter(group.card, event);
            }}
            onPointerLeave={() => {
              setHoveredIndex(null);
              onPointerLeave();
            }}
          >
            <CardThumbnail
              card={group.card}
              imageSize={width <= 115 ? "small" : "normal"}
              loading="lazy"
            />
            <CardCountBadge count={group.count} />
          </button>
        ))}
      </div>
    </div>
  );
}

function BrowserSection({
  label,
  groups,
  viewMode,
  cardWidth,
  onOpen,
  onPointerEnter,
  onPointerLeave,
}: {
  label: string;
  groups: CardGroup[];
  viewMode: ViewMode;
  cardWidth: number;
  onOpen: (card: DeckCard) => void;
  onPointerEnter: (card: DeckCard, event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}) {
  if (groups.length === 0) return null;
  const count = groups.reduce((total, group) => total + group.count, 0);
  if (viewMode === "stack") {
    return (
      <BrowserStackColumn
        label={label}
        groups={groups}
        width={cardWidth}
        onOpen={onOpen}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      />
    );
  }
  return (
    <section className="min-w-0 break-inside-avoid">
      <SectionHeader label={label} count={count} />
      {viewMode === "list" ? (
        <div className="space-y-0.5">
          {groups.map((group) => (
            <BrowserCardRow
              key={group.card.identity.name}
              group={group}
              onOpen={onOpen}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {groups.map((group) => (
            <BrowserVisualCard
              key={group.card.identity.name}
              group={group}
              width={cardWidth}
              onOpen={onOpen}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function DeckCardBrowser({ deck }: { deck: Deck }) {
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState<BrowserZoneFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupByMode>("type");
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [cardSize, setCardSize] = useState(3);
  const [colorFilters, setColorFilters] = useState<string[]>([]);
  const [cardTypeFilter, setCardTypeFilter] = useState<BrowserCardTypeFilter>("all");
  const [manaValueFilter, setManaValueFilter] = useState<BrowserManaValueFilter>("all");
  const [detailCard, setDetailCard] = useState<ScryfallCard | null>(null);
  const [loadingCardName, setLoadingCardName] = useState<string | null>(null);
  const cardDetailRequestIdRef = useRef(0);
  const preview = useCardPreview([deck.id, search, zone, groupBy, viewMode]);
  const getCard = useScryfallStore((state) => state.getCard);
  const cardsByName = useMemo(
    () =>
      new Map(
        [
          ...deck.cards,
          ...deck.sideboard,
          ...(deck.commanders ?? []),
          ...(deck.companion ? [deck.companion] : []),
          ...(deck.maybeboard ?? []),
          ...(deck.attractions ?? []),
          ...(deck.contraptions ?? []),
          ...(deck.schemes ?? []),
          ...(deck.planes ?? []),
        ].map((card) => [card.identity.name, card]),
      ),
    [deck],
  );
  const longPress = useLongPressPreview<DeckCard>({
    resolve: (event) => {
      const element = (event.target as HTMLElement).closest<HTMLElement>("[data-card-name]");
      const card = element ? cardsByName.get(element.dataset.cardName ?? "") : undefined;
      return card && element ? { item: card, anchor: element } : null;
    },
    show: (card, rect) =>
      preview.handleMouseEnter(card as unknown as CardDto, undefined, {
        useAnchor: true,
        anchorOverride: rect,
      }),
    hide: preview.dismiss,
  });
  const cardWidth = CARD_WIDTH_MAP[cardSize] ?? 115;
  const deferredSearch = useDeferredValue(search);
  const terms = useMemo(() => parseFilterTerms(deferredSearch), [deferredSearch]);
  const mainZoneCount =
    deck.cards.length +
    (deck.commanders?.length ?? 0) +
    (deck.companion ? 1 : 0) +
    (deck.attractions?.length ?? 0) +
    (deck.contraptions?.length ?? 0) +
    (deck.schemes?.length ?? 0) +
    (deck.planes?.length ?? 0);
  const sideboardZoneCount = deck.sideboard.length;
  const maybeboardZoneCount = deck.maybeboard?.length ?? 0;
  const totalCount = mainZoneCount + sideboardZoneCount + maybeboardZoneCount;
  const zoneOptions = [
    { value: "all" as const, label: "All", count: totalCount },
    { value: "main" as const, label: "Main", count: mainZoneCount },
    ...(sideboardZoneCount > 0
      ? [{ value: "side" as const, label: "Sideboard", count: sideboardZoneCount }]
      : []),
    ...(maybeboardZoneCount > 0
      ? [{ value: "maybe" as const, label: "Maybe", count: maybeboardZoneCount }]
      : []),
  ];
  const hasFilters =
    search.trim().length > 0 ||
    zone !== "all" ||
    colorFilters.length > 0 ||
    cardTypeFilter !== "all" ||
    manaValueFilter !== "all";

  const {
    commanders,
    companion,
    visibleMainSections,
    sideboard,
    maybeboard,
    specialSections,
    shownCount,
  } = useMemo(() => {
    const matches = (card: DeckCard) => {
      const searchableText = [
        card.identity.name,
        ...card.supertypes,
        ...card.types,
        ...card.subtypes,
        card.text,
      ]
        .join(" ")
        .toLowerCase();
      return (
        (terms.length === 0 || terms.some((term) => searchableText.includes(term))) &&
        matchesColorIdentity(card, colorFilters) &&
        matchesCardType(card, cardTypeFilter) &&
        matchesManaValue(card, manaValueFilter)
      );
    };
    const showMain = zone === "all" || zone === "main";
    const filteredCommanders = showMain ? (deck.commanders ?? []).filter(matches) : [];
    const filteredCompanion =
      showMain && deck.companion && matches(deck.companion) ? [deck.companion] : [];
    const mainCards = showMain ? deck.cards.filter(matches) : [];
    const filteredSideboard =
      zone === "all" || zone === "side" ? deck.sideboard.filter(matches) : [];
    const filteredMaybeboard =
      zone === "all" || zone === "maybe" ? (deck.maybeboard ?? []).filter(matches) : [];
    const filteredSpecialSections = showMain
      ? [
          { label: "Attractions", cards: deck.attractions ?? [] },
          { label: "Contraptions", cards: deck.contraptions ?? [] },
          { label: "Schemes", cards: deck.schemes ?? [] },
          { label: "Planes", cards: deck.planes ?? [] },
        ]
          .map((section) => ({ ...section, groups: groupCards(section.cards.filter(matches)) }))
          .filter((section) => section.groups.length > 0)
      : [];
    const { sections, otherGroups } = computeGroupedSections(mainCards, groupBy);
    const stackColumns = computeGroupedStackColumns(mainCards, groupBy);
    const groupedMainSections =
      viewMode === "stack"
        ? stackColumns
        : [
            ...sections,
            ...(otherGroups.length
              ? [{ id: "other", label: "Other", groups: otherGroups, filter: () => false }]
              : []),
          ];
    const filteredCount =
      filteredCommanders.length +
      filteredCompanion.length +
      mainCards.length +
      filteredSideboard.length +
      filteredMaybeboard.length +
      filteredSpecialSections.reduce(
        (total, section) =>
          total + section.groups.reduce((sectionTotal, group) => sectionTotal + group.count, 0),
        0,
      );
    return {
      commanders: filteredCommanders,
      companion: filteredCompanion,
      visibleMainSections: groupedMainSections,
      sideboard: filteredSideboard,
      maybeboard: filteredMaybeboard,
      specialSections: filteredSpecialSections,
      shownCount: filteredCount,
    };
  }, [cardTypeFilter, colorFilters, deck, groupBy, manaValueFilter, terms, viewMode, zone]);

  function clearFilters() {
    setSearch("");
    setZone("all");
    setColorFilters([]);
    setCardTypeFilter("all");
    setManaValueFilter("all");
  }

  function toggleColorFilter(color: string) {
    setColorFilters((current) =>
      current.includes(color) ? current.filter((value) => value !== color) : [...current, color],
    );
  }

  function handlePointerEnter(card: DeckCard, event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    preview.handleMouseEnter(card as unknown as CardDto, event as unknown as React.MouseEvent, {
      useDelay: true,
    });
  }

  async function openCard(card: DeckCard) {
    const requestId = ++cardDetailRequestIdRef.current;
    setLoadingCardName(card.identity.name);
    try {
      const entry = await getCard({
        name: card.identity.name,
        setCode: card.identity.setCode,
        collectorNumber: card.identity.cardNumber,
      });
      if (cardDetailRequestIdRef.current !== requestId) return;
      setDetailCard(entry.info);
    } catch (error) {
      if (cardDetailRequestIdRef.current !== requestId) return;
      toast.error(error instanceof Error ? error.message : "Card details are unavailable");
    } finally {
      if (cardDetailRequestIdRef.current === requestId) setLoadingCardName(null);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b bg-background/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search card names, types, and rules text"
              placeholder="Search cards…"
              className="h-8 pl-8 pr-8 text-xs pointer-coarse:h-10 pointer-coarse:text-base"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear card search"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground pointer-coarse:p-2"
                onClick={() => setSearch("")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {shownCount === totalCount ? totalCount : `${shownCount} / ${totalCount}`} cards
          </span>
        </div>

        <DeckCardBrowserFilters
          zone={zone}
          zoneOptions={zoneOptions}
          onZoneChange={setZone}
          groupBy={groupBy}
          onGroupByChange={setGroupBy}
          cardType={cardTypeFilter}
          onCardTypeChange={setCardTypeFilter}
          manaValue={manaValueFilter}
          onManaValueChange={setManaValueFilter}
          colors={colorFilters}
          onColorToggle={toggleColorFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          cardSize={cardSize}
          onCardSizeChange={setCardSize}
          hasFilters={hasFilters}
          onClear={clearFilters}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" {...longPress}>
        {shownCount === 0 ? (
          <div className="grid min-h-48 place-items-center text-center">
            <div>
              <p className="text-sm font-medium">No cards match these filters</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          </div>
        ) : viewMode === "stack" ? (
          <div className="flex flex-wrap items-start gap-5">
            {commanders.length > 0 && (
              <BrowserStackColumn
                label={commanders.length > 1 ? "Commanders" : "Commander"}
                groups={groupCards(commanders)}
                width={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {companion.length > 0 && (
              <BrowserStackColumn
                label="Companion"
                groups={groupCards(companion)}
                width={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {visibleMainSections.map((section) => (
              <BrowserSection
                key={section.id}
                label={section.label}
                groups={section.groups}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            ))}
            {sideboard.length > 0 && (
              <BrowserStackColumn
                label="Sideboard"
                groups={groupCards(sideboard)}
                width={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {maybeboard.length > 0 && (
              <BrowserStackColumn
                label="Maybeboard"
                groups={groupCards(maybeboard)}
                width={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {specialSections.map((section) => (
              <BrowserStackColumn
                key={section.label}
                label={section.label}
                groups={section.groups}
                width={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            ))}
          </div>
        ) : (
          <div
            className={cn(
              viewMode === "list" ? "columns-1 gap-5 md:columns-2 xl:columns-3" : "space-y-5",
            )}
          >
            {commanders.length > 0 && (
              <BrowserSection
                label={commanders.length > 1 ? "Commanders" : "Commander"}
                groups={groupCards(commanders)}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {companion.length > 0 && (
              <BrowserSection
                label="Companion"
                groups={groupCards(companion)}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {visibleMainSections.map((section) => (
              <BrowserSection
                key={section.id}
                label={section.label}
                groups={section.groups}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            ))}
            {sideboard.length > 0 && (
              <BrowserSection
                label="Sideboard"
                groups={groupCards(sideboard)}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {maybeboard.length > 0 && (
              <BrowserSection
                label="Maybeboard"
                groups={groupCards(maybeboard)}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            )}
            {specialSections.map((section) => (
              <BrowserSection
                key={section.label}
                label={section.label}
                groups={section.groups}
                viewMode={viewMode}
                cardWidth={cardWidth}
                onOpen={(card) => void openCard(card)}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={preview.handleMouseLeave}
              />
            ))}
          </div>
        )}
      </div>

      {loadingCardName && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-40 flex justify-center">
          <span className="flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs shadow-lg">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading {loadingCardName}…
          </span>
        </div>
      )}
      <HoverCardPreview preview={preview} imageSize="normal" />
      {detailCard && <CardDetailModal card={detailCard} onClose={() => setDetailCard(null)} />}
    </div>
  );
}
