import { useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronDown, Grid3X3, Layers3, List, Loader2, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { CardDetailModal } from "@/components/editor/CardDetailModal";
import {
  CardCountBadge,
  CardThumbnail,
  SectionHeader,
} from "@/components/editor/deckEditor.primitives";
import {
  CARD_WIDTH_MAP,
  computeGroupedSections,
  computeGroupedStackColumns,
  GROUP_BY_OPTIONS,
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

type ZoneFilter = "all" | "main" | "side" | "maybe";
type ManaValueFilter = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7+";

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string; icon: typeof List }> = [
  { value: "list", label: "List", icon: List },
  { value: "visual", label: "Visual", icon: Grid3X3 },
  { value: "stack", label: "Stack", icon: Layers3 },
];

const ZONE_OPTIONS: Array<{ value: ZoneFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "main", label: "Main" },
  { value: "side", label: "Sideboard" },
  { value: "maybe", label: "Maybe" },
];

const COLOR_OPTIONS = [
  { value: "W", label: "White" },
  { value: "U", label: "Blue" },
  { value: "B", label: "Black" },
  { value: "R", label: "Red" },
  { value: "G", label: "Green" },
  { value: "C", label: "Colorless" },
] as const;

const MANA_VALUE_OPTIONS: ManaValueFilter[] = ["all", "0", "1", "2", "3", "4", "5", "6", "7+"];

function matchesManaValue(card: DeckCard, filter: ManaValueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "7+") return card.cmc >= 7;
  return Math.round(card.cmc) === Number(filter);
}

function matchesColor(card: DeckCard, color: string): boolean {
  if (!color) return true;
  if (color === "C") return card.color.length === 0;
  return card.color.includes(color);
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
      <CardThumbnail card={group.card} />
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
            <CardThumbnail card={group.card} />
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
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupByMode>("type");
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [cardSize, setCardSize] = useState(3);
  const [colorFilter, setColorFilter] = useState("");
  const [manaValueFilter, setManaValueFilter] = useState<ManaValueFilter>("all");
  const [detailCard, setDetailCard] = useState<ScryfallCard | null>(null);
  const [loadingCardName, setLoadingCardName] = useState<string | null>(null);
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
  const terms = useMemo(() => parseFilterTerms(search), [search]);
  const hasFilters =
    terms.length > 0 || zone !== "all" || colorFilter !== "" || manaValueFilter !== "all";

  const matches = (card: DeckCard) =>
    (terms.length === 0 || terms.some((term) => card.identity.name.toLowerCase().includes(term))) &&
    matchesColor(card, colorFilter) &&
    matchesManaValue(card, manaValueFilter);

  const showMain = zone === "all" || zone === "main";
  const commanders = showMain ? (deck.commanders ?? []).filter(matches) : [];
  const companion = showMain && deck.companion && matches(deck.companion) ? [deck.companion] : [];
  const mainCards = showMain ? deck.cards.filter(matches) : [];
  const sideboard = zone === "all" || zone === "side" ? deck.sideboard.filter(matches) : [];
  const maybeboard =
    zone === "all" || zone === "maybe" ? (deck.maybeboard ?? []).filter(matches) : [];
  const specialSections = showMain
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
  const visibleMainSections =
    viewMode === "stack"
      ? stackColumns
      : [
          ...sections,
          ...(otherGroups.length
            ? [{ id: "other", label: "Other", groups: otherGroups, filter: () => false }]
            : []),
        ];
  const shownCount =
    commanders.length +
    companion.length +
    mainCards.length +
    sideboard.length +
    maybeboard.length +
    specialSections.reduce(
      (total, section) =>
        total + section.groups.reduce((sectionTotal, group) => sectionTotal + group.count, 0),
      0,
    );
  const totalCount =
    (deck.commanders?.length ?? 0) +
    (deck.companion ? 1 : 0) +
    deck.cards.length +
    deck.sideboard.length +
    (deck.maybeboard?.length ?? 0) +
    (deck.attractions?.length ?? 0) +
    (deck.contraptions?.length ?? 0) +
    (deck.schemes?.length ?? 0) +
    (deck.planes?.length ?? 0);

  function clearFilters() {
    setSearch("");
    setZone("all");
    setColorFilter("");
    setManaValueFilter("all");
  }

  function handlePointerEnter(card: DeckCard, event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") return;
    preview.handleMouseEnter(card as unknown as CardDto, event as unknown as React.MouseEvent, {
      useDelay: true,
    });
  }

  async function openCard(card: DeckCard) {
    setLoadingCardName(card.identity.name);
    try {
      const entry = await getCard({
        name: card.identity.name,
        setCode: card.identity.setCode,
        collectorNumber: card.identity.cardNumber,
      });
      setDetailCard(entry.info);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Card details are unavailable");
    } finally {
      setLoadingCardName(null);
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
              aria-label="Filter cards by name"
              placeholder="Filter cards…"
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

        <div className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 no-scrollbar">
          {ZONE_OPTIONS.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={zone === option.value ? "secondary" : "ghost"}
              size="sm"
              className="shrink-0"
              aria-pressed={zone === option.value}
              onClick={() => setZone(option.value)}
            >
              {option.label}
            </Button>
          ))}

          <div className="mx-1 h-5 w-px shrink-0 bg-border" />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="shrink-0">
                {GROUP_BY_OPTIONS.find((option) => option.value === groupBy)?.label}
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {GROUP_BY_OPTIONS.filter((option) => option.value !== "custom").map((option) => (
                <DropdownMenuItem key={option.value} onSelect={() => setGroupBy(option.value)}>
                  {option.label}
                  {groupBy === option.value && <Check className="ml-auto h-3.5 w-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <select
            value={manaValueFilter}
            aria-label="Filter by mana value"
            className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs pointer-coarse:h-10 pointer-coarse:text-base"
            onChange={(event) => setManaValueFilter(event.target.value as ManaValueFilter)}
          >
            {MANA_VALUE_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "all" ? "Any mana" : `${value} mana`}
              </option>
            ))}
          </select>

          <div className="flex shrink-0 items-center gap-0.5 rounded-md border bg-background p-0.5">
            {COLOR_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.label}
                aria-label={`Filter by ${option.label}`}
                aria-pressed={colorFilter === option.value}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded opacity-45 transition-opacity hover:opacity-80 pointer-coarse:h-10 pointer-coarse:w-10",
                  colorFilter === option.value && "bg-primary/15 opacity-100 ring-1 ring-primary",
                )}
                onClick={() =>
                  setColorFilter((current) => (current === option.value ? "" : option.value))
                }
              >
                <ManaSymbols cost={`{${option.value}}`} size="sm" className="m-0" />
              </button>
            ))}
          </div>

          <div className="mx-1 h-5 w-px shrink-0 bg-border" />

          <div className="flex shrink-0 overflow-hidden rounded-md border">
            {VIEW_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.value}
                  type="button"
                  title={`${option.label} view`}
                  aria-label={`${option.label} view`}
                  aria-pressed={viewMode === option.value}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center border-r text-muted-foreground transition-colors last:border-r-0 pointer-coarse:h-10 pointer-coarse:w-10",
                    viewMode === option.value
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted",
                  )}
                  onClick={() => setViewMode(option.value)}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          {viewMode !== "list" && (
            <input
              type="range"
              min={1}
              max={6}
              step={1}
              value={cardSize}
              aria-label="Card size"
              className="h-1 w-24 shrink-0 cursor-pointer accent-primary sm:w-32"
              onChange={(event) => setCardSize(Number(event.target.value))}
            />
          )}

          {hasFilters && (
            <Button variant="ghost" size="sm" className="shrink-0" onClick={clearFilters}>
              Clear
            </Button>
          )}
        </div>
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
