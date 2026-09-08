import type { RefObject } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MANA_LETTERS } from "@/themes/gameTheme";
import type { CardBrowserState } from "./cardBrowser";

interface Props {
  search: RefObject<HTMLInputElement | null>;
  state: CardBrowserState;
  types: string[];
  modeLabel: string;
  visibleCount: number;
  totalCount: number;
  selectedCount: number;
  hasActions: boolean;
  loading: boolean;
  incomplete: boolean;
  onFilter: (patch: Partial<CardBrowserState>) => void;
  onSize: (size: number) => void;
}
export function DialogCardBrowserToolbar({
  search,
  state,
  types,
  modeLabel,
  visibleCount,
  totalCount,
  selectedCount,
  hasActions,
  loading,
  incomplete,
  onFilter,
  onSize,
}: Props) {
  return (
    <div className="space-y-2 border-b p-3 shrink-0">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            ref={search}
            data-autofocus
            aria-label="Search cards by name, rules, type or mana"
            placeholder="Search names, rules, types or mana…"
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
        <span className="shrink-0 text-xs text-muted-foreground" role="status" aria-live="polite">
          {visibleCount} / {totalCount}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border px-2 py-1 font-semibold">{modeLabel}</span>
        <select
          aria-label="Card type"
          value={state.type}
          onChange={(event) => onFilter({ type: event.target.value })}
          className="h-9 rounded-md border bg-background px-2 pointer-coarse:text-base"
        >
          <option value="">All types</option>
          {types.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <select
          aria-label="Card color"
          value={state.color}
          onChange={(event) => onFilter({ color: event.target.value })}
          className="h-9 rounded-md border bg-background px-2 pointer-coarse:text-base"
        >
          <option value="">All colors</option>
          {MANA_LETTERS.map((color) => (
            <option key={color}>{color}</option>
          ))}
        </select>
        <select
          aria-label="Card sort order"
          value={state.sort}
          onChange={(event) => onFilter({ sort: event.target.value as CardBrowserState["sort"] })}
          className="h-9 rounded-md border bg-background px-2 pointer-coarse:text-base"
        >
          <option value="zone">Zone order</option>
          <option value="name">Name</option>
          <option value="mana">Mana value</option>
        </select>
        {hasActions && (
          <Button
            variant={state.onlyActions ? "default" : "outline"}
            size="sm"
            aria-pressed={state.onlyActions}
            onClick={() => onFilter({ onlyActions: !state.onlyActions })}
          >
            Available actions
          </Button>
        )}
        <label className="ml-auto flex items-center gap-2">
          Card size
          <input
            aria-label="Card size"
            type="range"
            min={104}
            max={220}
            step={8}
            value={state.size}
            onChange={(event) => onSize(Number(event.target.value))}
            className="w-20 accent-primary"
          />
        </label>
      </div>
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
