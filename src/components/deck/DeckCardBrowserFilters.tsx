import { Grid3X3, Layers3, List, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import {
  GROUP_BY_OPTIONS,
  type GroupByMode,
  type ViewMode,
} from "@/components/editor/deckBuilder.utils";
import { cn } from "@/lib/utils";
import { MANA_LETTERS } from "@/themes/gameTheme";

export type BrowserZoneFilter = "all" | "main" | "side" | "maybe";
export type BrowserManaValueFilter = "all" | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7+";
export type BrowserCardTypeFilter =
  | "all"
  | "creature"
  | "land"
  | "instant"
  | "sorcery"
  | "artifact"
  | "enchantment"
  | "planeswalker";

interface ZoneOption {
  value: BrowserZoneFilter;
  label: string;
  count: number;
}

interface DeckCardBrowserFiltersProps {
  zone: BrowserZoneFilter;
  zoneOptions: ZoneOption[];
  onZoneChange: (zone: BrowserZoneFilter) => void;
  groupBy: GroupByMode;
  onGroupByChange: (groupBy: GroupByMode) => void;
  cardType: BrowserCardTypeFilter;
  onCardTypeChange: (cardType: BrowserCardTypeFilter) => void;
  manaValue: BrowserManaValueFilter;
  onManaValueChange: (manaValue: BrowserManaValueFilter) => void;
  colors: string[];
  onColorToggle: (color: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (viewMode: ViewMode) => void;
  cardSize: number;
  onCardSizeChange: (cardSize: number) => void;
  hasFilters: boolean;
  onClear: () => void;
}

const VIEW_OPTIONS: Array<{ value: ViewMode; label: string; icon: typeof List }> = [
  { value: "list", label: "List", icon: List },
  { value: "visual", label: "Visual", icon: Grid3X3 },
  { value: "stack", label: "Stack", icon: Layers3 },
];

const MANA_VALUE_OPTIONS: BrowserManaValueFilter[] = [
  "all",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7+",
];

const CARD_TYPE_OPTIONS: Array<{ value: BrowserCardTypeFilter; label: string }> = [
  { value: "all", label: "Any type" },
  { value: "creature", label: "Creature" },
  { value: "land", label: "Land" },
  { value: "instant", label: "Instant" },
  { value: "sorcery", label: "Sorcery" },
  { value: "artifact", label: "Artifact" },
  { value: "enchantment", label: "Enchantment" },
  { value: "planeswalker", label: "Planeswalker" },
];

const COLOR_LABELS: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

function ViewControl({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (viewMode: ViewMode) => void;
}) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border">
      {VIEW_OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            title={`${option.label} view`}
            aria-label={`${option.label} view`}
            aria-pressed={value === option.value}
            className={cn(
              "flex h-8 w-8 items-center justify-center border-r text-muted-foreground transition-colors last:border-r-0 pointer-coarse:h-10 pointer-coarse:w-10",
              value === option.value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
            onClick={() => onChange(option.value)}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}

function ColorControl({
  colors,
  onToggle,
}: {
  colors: string[];
  onToggle: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-md border bg-background p-1">
      {MANA_LETTERS.map((color) => (
        <button
          key={color}
          type="button"
          title={COLOR_LABELS[color]}
          aria-label={`Filter by ${COLOR_LABELS[color]} identity`}
          aria-pressed={colors.includes(color)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded opacity-45 transition-opacity hover:opacity-80 pointer-coarse:h-10 pointer-coarse:w-10",
            colors.includes(color) && "bg-primary/15 opacity-100 ring-1 ring-primary",
          )}
          onClick={() => onToggle(color)}
        >
          <ManaSymbols cost={`{${color}}`} size="sm" className="m-0" />
        </button>
      ))}
    </div>
  );
}

export function DeckCardBrowserFilters({
  zone,
  zoneOptions,
  onZoneChange,
  groupBy,
  onGroupByChange,
  cardType,
  onCardTypeChange,
  manaValue,
  onManaValueChange,
  colors,
  onColorToggle,
  viewMode,
  onViewModeChange,
  cardSize,
  onCardSizeChange,
  hasFilters,
  onClear,
}: DeckCardBrowserFiltersProps) {
  const activeFilterCount =
    Number(zone !== "all") +
    Number(cardType !== "all") +
    Number(manaValue !== "all") +
    colors.length;

  const zoneControl = (
    <div className="flex flex-wrap items-center gap-1">
      {zoneOptions.map((option) => (
        <Button
          key={option.value}
          type="button"
          variant={zone === option.value ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={zone === option.value}
          onClick={() => onZoneChange(option.value)}
        >
          {option.label}
          <span className="text-[10px] tabular-nums text-muted-foreground">{option.count}</span>
        </Button>
      ))}
    </div>
  );

  const groupControl = (
    <select
      value={groupBy}
      aria-label="Group cards by"
      className="h-9 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
      onChange={(event) => onGroupByChange(event.target.value as GroupByMode)}
    >
      {GROUP_BY_OPTIONS.filter((option) => option.value !== "custom").map((option) => (
        <option key={option.value} value={option.value}>
          Group: {option.label}
        </option>
      ))}
    </select>
  );

  const typeControl = (
    <select
      value={cardType}
      aria-label="Filter by card type"
      className="h-9 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
      onChange={(event) => onCardTypeChange(event.target.value as BrowserCardTypeFilter)}
    >
      {CARD_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  const manaControl = (
    <select
      value={manaValue}
      aria-label="Filter by mana value"
      className="h-9 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
      onChange={(event) => onManaValueChange(event.target.value as BrowserManaValueFilter)}
    >
      {MANA_VALUE_OPTIONS.map((value) => (
        <option key={value} value={value}>
          {value === "all" ? "Any mana value" : `Mana value: ${value}`}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="flex items-center justify-between gap-2 sm:hidden">
        <ViewControl value={viewMode} onChange={onViewModeChange} />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl">
            <SheetHeader className="pr-8 text-left">
              <SheetTitle>Card filters</SheetTitle>
              <SheetDescription>
                Colors match any selected color identity. Search also matches type and rules text.
              </SheetDescription>
            </SheetHeader>
            <div className="mt-5 space-y-5">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Deck section</p>
                {zoneControl}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {groupControl}
                {typeControl}
                <div className="col-span-2">{manaControl}</div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Color identity</p>
                <ColorControl colors={colors} onToggle={onColorToggle} />
              </div>
              {viewMode !== "list" && (
                <label className="block text-xs font-medium text-muted-foreground">
                  Card size
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={1}
                    value={cardSize}
                    className="mt-3 block h-2 w-full cursor-pointer accent-primary"
                    onChange={(event) => onCardSizeChange(Number(event.target.value))}
                  />
                </label>
              )}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={!hasFilters} onClick={onClear}>
                Clear filters
              </Button>
              <SheetClose asChild>
                <Button>Show cards</Button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="-mx-1 hidden items-center gap-1 overflow-x-auto px-1 pb-1 no-scrollbar sm:flex">
        {zoneControl}
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        {groupControl}
        {typeControl}
        {manaControl}
        <ColorControl colors={colors} onToggle={onColorToggle} />
        <div className="mx-1 h-5 w-px shrink-0 bg-border" />
        <ViewControl value={viewMode} onChange={onViewModeChange} />
        {viewMode !== "list" && (
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={cardSize}
            aria-label="Card size"
            className="h-1 w-24 shrink-0 cursor-pointer accent-primary sm:w-32"
            onChange={(event) => onCardSizeChange(Number(event.target.value))}
          />
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </>
  );
}
