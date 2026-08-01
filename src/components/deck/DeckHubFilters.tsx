import { LayoutGrid, List, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeckHubFilterSheet } from "@/components/deck/DeckHubFilterSheet";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubFacets } from "@/api/hubTypes";
import { FORMAT_DISPLAY } from "@/lib/constants";

const DEFAULT_FORMATS = ["commander", "standard", "pioneer", "modern", "pauper", "brawl"];

interface DeckHubFiltersProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  domainV2: boolean;
  activeFilterCount: number;
  favoritesEnabled: boolean;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilters({
  filters,
  facets,
  domainV2,
  activeFilterCount,
  favoritesEnabled,
  onChange,
  onClear,
}: DeckHubFiltersProps) {
  const formats = facets?.formats.length ? facets.formats.map((item) => item.key) : DEFAULT_FORMATS;
  const toggleFormat = (format: string) =>
    onChange({
      formats: !domainV2
        ? filters.formats.includes(format)
          ? []
          : [format]
        : filters.formats.includes(format)
          ? filters.formats.filter((item) => item !== format)
          : [...filters.formats, format],
    });

  return (
    <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-md">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value })}
            aria-label="Search Deck Hub"
            placeholder="Search decks, authors, commanders, or cards"
            className="h-10 pl-9 pr-9 pointer-coarse:text-base"
          />
          {filters.search && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-2 text-muted-foreground hover:text-foreground"
              onClick={() => onChange({ search: "" })}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 lg:ml-auto">
          <select
            value={filters.sort}
            aria-label="Sort Deck Hub"
            className="h-10 min-w-0 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:text-base"
            onChange={(event) =>
              onChange({ sort: event.target.value as DeckHubDiscoveryFilters["sort"] })
            }
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            {domainV2 && <option value="favorites">Most favorited</option>}
          </select>

          {domainV2 && (
            <DeckHubFilterSheet
              filters={filters}
              facets={facets}
              activeFilterCount={activeFilterCount}
              favoritesEnabled={favoritesEnabled}
              onChange={onChange}
              onClear={onClear}
            />
          )}

          {domainV2 && (
            <div className="flex rounded-md border p-0.5">
              <Button
                variant={filters.view === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                aria-label="Grid view"
                aria-pressed={filters.view === "grid"}
                onClick={() => onChange({ view: "grid" })}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button
                variant={filters.view === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                aria-label="List view"
                aria-pressed={filters.view === "list"}
                onClick={() => onChange({ view: "list" })}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 pb-1 no-scrollbar">
          <Button
            variant={filters.formats.length === 0 ? "secondary" : "ghost"}
            size="sm"
            className="shrink-0"
            onClick={() => onChange({ formats: [] })}
          >
            All formats
          </Button>
          {formats.map((format) => (
            <Button
              key={format}
              variant={filters.formats.includes(format) ? "secondary" : "ghost"}
              size="sm"
              className="shrink-0"
              aria-pressed={filters.formats.includes(format)}
              onClick={() => toggleFormat(format)}
            >
              {FORMAT_DISPLAY[format] ?? format}
              {facets?.formats.find((item) => item.key === format) && (
                <span className="text-xs text-muted-foreground">
                  {facets.formats.find((item) => item.key === format)?.count}
                </span>
              )}
            </Button>
          ))}
        </div>
        {domainV2 && (
          <select
            value={filters.group}
            aria-label="Group Deck Hub results"
            className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
            onChange={(event) =>
              onChange({ group: event.target.value as DeckHubDiscoveryFilters["group"] })
            }
          >
            <option value="none">No grouping</option>
            <option value="source">Group by source</option>
            <option value="format">Group by format</option>
            <option value="color">Group by color</option>
            <option value="tag">Group by tag</option>
          </select>
        )}
        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="hidden shrink-0 sm:flex" onClick={onClear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
