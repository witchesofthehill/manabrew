import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormatBadge } from "@/components/game/FormatBadge";
import { cn } from "@/lib/utils";
import { Check, ChevronDown, Palette, Search, X } from "lucide-react";
import { GAME_FORMATS } from "@/lib/formats";
import type { SortBy } from "@/views/myDecks.utils";
import { MANA_LETTERS, type ManaLetter } from "@/themes/gameTheme";
import { manaSymbolUrl } from "@/api/scryfall";
import { ScryfallImg } from "@/components/ScryfallImg";
import { useIsTouch } from "@/hooks/useBreakpoints";

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

const SELECT_CLS =
  "h-9 min-w-0 flex-1 cursor-pointer rounded border bg-background px-2 text-xs pointer-coarse:h-11 pointer-coarse:text-base";

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
  const isTouch = useIsTouch();
  const hasActiveFilters = search || formatFilter || colorFilter.length > 0;

  function clearAll() {
    onSearchChange("");
    onFormatChange("");
    colorFilter.forEach(onColorToggle);
  }

  return (
    <div
      className={cn(
        "mt-2 flex shrink-0 items-center gap-1 px-4 py-1.5 sm:px-6 lg:px-8",
        isTouch && "flex-wrap gap-2 py-2",
      )}
    >
      <div className={cn("relative min-w-0 flex-[2]", isTouch && "w-full flex-none sm:flex-1")}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search decks"
          placeholder="Search decks…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-9 pl-9 pr-11 text-xs pointer-coarse:h-11 pointer-coarse:text-base"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear deck search"
            className="absolute right-0 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => onSearchChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div
        className={cn(
          "flex min-w-0 flex-[1] items-center gap-1",
          isTouch && "w-full flex-none gap-2 sm:w-auto sm:flex-1",
        )}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Filter by format"
              title="Filter by format"
              className={cn(
                SELECT_CLS,
                "flex items-center justify-between gap-1 hover:bg-muted/40",
              )}
            >
              {formatFilter ? (
                <FormatBadge formatId={formatFilter} />
              ) : (
                <span className="text-muted-foreground">All formats</span>
              )}
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => onFormatChange("")} className="gap-2">
              <span className="text-xs">All formats</span>
              {!formatFilter && <Check className="ml-auto h-3 w-3 text-primary" />}
            </DropdownMenuItem>
            {GAME_FORMATS.map((format) => (
              <DropdownMenuItem
                key={format.id}
                onSelect={() => onFormatChange(format.id)}
                className="gap-2"
              >
                <FormatBadge formatId={format.id} />
                <span className="text-xs">{format.name}</span>
                {formatFilter === format.id && <Check className="ml-auto h-3 w-3 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <select
          value={sortBy}
          aria-label="Sort decks"
          onChange={(event) => onSortChange(event.target.value as SortBy)}
          title="Sort order"
          className={SELECT_CLS}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {isTouch ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  SELECT_CLS,
                  "flex items-center justify-center gap-2",
                  colorFilter.length > 0 && "border-selection text-selection",
                )}
              >
                <Palette className="h-4 w-4" />
                Colors{colorFilter.length > 0 ? ` · ${colorFilter.length}` : ""}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {MANA_LETTERS.map((color) => {
                const active = colorFilter.includes(color);
                return (
                  <DropdownMenuItem
                    key={color}
                    className="gap-2"
                    onSelect={(event) => {
                      event.preventDefault();
                      onColorToggle(color);
                    }}
                  >
                    <ScryfallImg
                      src={manaSymbolUrl(color)}
                      alt=""
                      className="h-5 w-5 rounded-full"
                    />
                    {COLOR_LABEL[color]}
                    {active && <Check className="ml-auto h-4 w-4 text-selection" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          MANA_LETTERS.map((color) => {
            const active = colorFilter.includes(color);
            return (
              <button
                key={color}
                type="button"
                aria-label={`Filter by ${COLOR_LABEL[color]}`}
                title={`Filter by ${COLOR_LABEL[color]}`}
                onClick={() => onColorToggle(color)}
                className={cn(
                  "h-4 w-4 shrink-0 overflow-hidden rounded-full border-2 transition-all focus:outline-none",
                  active
                    ? "scale-110 border-selection"
                    : "border-transparent opacity-40 hover:opacity-70",
                )}
              >
                <ScryfallImg src={manaSymbolUrl(color)} alt={color} className="h-full w-full" />
              </button>
            );
          })
        )}

        {hasActiveFilters && (
          <button
            type="button"
            aria-label="Clear all filters"
            title="Clear all filters"
            onClick={clearAll}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
