import { useState, type ReactNode, type RefObject } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { ANY_COLOR_LETTERS } from "@/components/game/manaUtils";
import { cn } from "@/lib/utils";
import type { CardBrowserState } from "./cardBrowser";

interface Props {
  search: RefObject<HTMLInputElement | null>;
  state: CardBrowserState;
  types: string[];
  visibleCount: number;
  totalCount: number;
  selectedCount: number;
  loading: boolean;
  incomplete: boolean;
  onFilter: (patch: Partial<CardBrowserState>) => void;
}

const COLOR_LABELS: Record<(typeof ANY_COLOR_LETTERS)[number], string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="relative min-w-32 flex-1">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full appearance-none rounded-md border bg-background pl-2 pr-7 text-sm pointer-coarse:text-base"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
export function DialogCardBrowserToolbar({
  search,
  state,
  types,
  visibleCount,
  totalCount,
  selectedCount,
  loading,
  incomplete,
  onFilter,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount =
    Number(!!state.type) + Number(!!state.color) + Number(state.sort !== "zone");

  return (
    <div className="shrink-0 space-y-2 border-b p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md sm:flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={search}
            aria-label="Search cards by name, rules, type or mana"
            placeholder="Search cards"
            value={state.query}
            onChange={(event) => onFilter({ query: event.target.value })}
            className="pl-9 pr-9 focus-visible:ring-card-ring"
          />
          {state.query && (
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-0 top-0 h-9 w-9"
              aria-label="Clear search"
              onClick={() => {
                onFilter({ query: "" });
                search.current?.focus();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <span
            className="ml-auto shrink-0 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {visibleCount === totalCount
              ? `${totalCount} card${totalCount === 1 ? "" : "s"}`
              : `${visibleCount} of ${totalCount} cards`}
          </span>
        </div>
      </div>
      {filtersOpen && (
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <FilterSelect
            label="Card type"
            value={state.type}
            onChange={(type) => onFilter({ type })}
          >
            <option value="">All types</option>
            {types.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </FilterSelect>
          <div
            role="group"
            aria-label="Card color"
            className="flex h-9 flex-wrap items-center gap-1 rounded-md border bg-background px-1 pointer-coarse:h-12"
          >
            {ANY_COLOR_LETTERS.map((color) => {
              const active = state.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  title={COLOR_LABELS[color]}
                  aria-label={`Filter by ${COLOR_LABELS[color]} identity`}
                  aria-pressed={active}
                  className={cn(
                    "relative flex h-8 w-8 items-center justify-center rounded opacity-45 transition-opacity hover:opacity-80 pointer-coarse:h-10 pointer-coarse:w-10",
                    active && "opacity-100",
                  )}
                  onClick={() => onFilter({ color: active ? "" : color })}
                >
                  {active && (
                    <span className="pointer-events-none absolute inset-1 rounded bg-primary/15 ring-1 ring-primary" />
                  )}
                  <ManaSymbols cost={`{${color}}`} size="sm" className="m-0" />
                </button>
              );
            })}
          </div>
          <FilterSelect
            label="Card sort order"
            value={state.sort}
            onChange={(sort) => onFilter({ sort: sort as CardBrowserState["sort"] })}
          >
            <option value="zone">Zone order</option>
            <option value="name">Name</option>
            <option value="mana">Mana value</option>
          </FilterSelect>
          <Button
            variant="ghost"
            size="sm"
            disabled={activeFilterCount === 0}
            onClick={() =>
              onFilter({
                type: "",
                color: "",
                sort: "zone",
              })
            }
          >
            Reset
          </Button>
        </div>
      )}
      {selectedCount > 0 && (
        <p className="text-xs text-muted-foreground">{selectedCount} selected</p>
      )}
      {(loading || incomplete) && (
        <p className="text-xs text-muted-foreground" role="status">
          {loading
            ? "Loading card details for search…"
            : "Some card details are unavailable. Visible names and game rules remain searchable."}
        </p>
      )}
    </div>
  );
}
