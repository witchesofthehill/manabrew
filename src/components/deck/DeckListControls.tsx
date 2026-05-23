import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormatBadge } from "@/components/game/FormatBadge";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { GAME_FORMATS } from "@/lib/formats";
import type { SortBy } from "@/views/myDecks.utils";
import { MANA_LETTERS, type ManaLetter } from "@/themes/gameTheme";
import { manaSymbolUrl } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";

type Color = ManaLetter;

const COLOR_LABEL: Record<Color, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "name", label: "A→Z" },
  { value: "color", label: "Color" },
  { value: "updated", label: "Date" },
];

const SELECT_CLS = "h-6 text-xs rounded border bg-background px-1 cursor-pointer flex-1 min-w-0";

interface DeckListControlsProps {
  search: string;
  onSearchChange: (v: string) => void;
  formatFilter: string;
  onFormatChange: (v: string) => void;
  colorFilter: string[];
  onColorToggle: (color: string) => void;
  sortBy: SortBy;
  onSortChange: (v: SortBy) => void;
}

export function DeckListControls({
  search,
  onSearchChange,
  formatFilter,
  onFormatChange,
  colorFilter,
  onColorToggle,
  sortBy,
  onSortChange,
}: DeckListControlsProps) {
  const hasActiveFilters = search || formatFilter || colorFilter.length > 0;

  function clearAll() {
    onSearchChange("");
    onFormatChange("");
    colorFilter.forEach(onColorToggle);
  }

  return (
    <div className="mt-2 flex items-center gap-1 px-2 py-1.5 shrink-0">
      {/* Search — takes 2/3 of the row */}
      <div className="relative flex-[2] min-w-0">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-6 pl-6 pr-5 text-xs"
        />
        {search && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => onSearchChange("")}
          >
            <X className="h-2.5 w-2.5" />
          </button>
        )}
      </div>

      {/* Remaining controls — take 1/3 of the row, keeping internal proportions */}
      <div className="flex-[1] flex items-center gap-1 min-w-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Filter by format"
              className={cn(
                SELECT_CLS,
                "flex items-center gap-1 justify-between hover:bg-muted/40",
              )}
            >
              {formatFilter ? (
                <FormatBadge formatId={formatFilter} />
              ) : (
                <span className="text-muted-foreground">All</span>
              )}
              <ChevronDown className="h-2.5 w-2.5 opacity-60 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => onFormatChange("")} className="gap-2">
              <span className="text-xs">All formats</span>
              {!formatFilter && <Check className="h-3 w-3 ml-auto text-primary" />}
            </DropdownMenuItem>
            {GAME_FORMATS.map((f) => (
              <DropdownMenuItem key={f.id} onSelect={() => onFormatChange(f.id)} className="gap-2">
                <FormatBadge formatId={f.id} />
                <span className="text-xs">{f.name}</span>
                {formatFilter === f.id && <Check className="h-3 w-3 ml-auto text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Sort */}
        <select
          value={sortBy}
          onChange={(e) => onSortChange(e.target.value as SortBy)}
          title="Sort order"
          className={SELECT_CLS}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Color pips */}
        {MANA_LETTERS.map((color) => {
          const active = colorFilter.includes(color);
          return (
            <button
              key={color}
              type="button"
              title={`Filter by ${COLOR_LABEL[color]}`}
              onClick={() => onColorToggle(color)}
              className={cn(
                "h-4 w-4 rounded-full border-2 transition-all overflow-hidden shrink-0 focus:outline-none",
                active
                  ? "border-primary scale-110"
                  : "border-transparent opacity-40 hover:opacity-70",
              )}
            >
              <ScryfallImg src={manaSymbolUrl(color)} alt={color} className="h-full w-full" />
            </button>
          );
        })}

        {/* Clear */}
        {hasActiveFilters && (
          <button
            type="button"
            title="Clear all filters"
            onClick={clearAll}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
