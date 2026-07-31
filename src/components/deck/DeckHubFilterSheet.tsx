import { Heart, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubFacets } from "@/api/hubTypes";
import { cn } from "@/lib/utils";

const COLORS = ["W", "U", "B", "R", "G", "C"];

interface DeckHubFilterSheetProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  activeFilterCount: number;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilterSheet({
  filters,
  facets,
  activeFilterCount,
  onChange,
  onClear,
}: DeckHubFilterSheetProps) {
  const toggleTag = (tag: string) =>
    onChange({
      tags: filters.tags.includes(tag)
        ? filters.tags.filter((item) => item !== tag)
        : [...filters.tags, tag],
    });
  const toggleColor = (color: string) => {
    if (color === "C") {
      onChange({ colors: filters.colors === "C" ? "" : "C" });
      return;
    }
    const selected = filters.colors.replace("C", "").split("").filter(Boolean);
    const next = selected.includes(color)
      ? selected.filter((item) => item !== color)
      : COLORS.filter((item) => item !== "C" && [...selected, color].includes(item));
    onChange({ colors: next.join("") });
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" className="relative h-10 gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader className="pr-8">
          <SheetTitle>Refine DeckHub</SheetTitle>
          <SheetDescription>
            Combine filters to find a published deck and inspect its exact card snapshot.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-4">
          <div className="space-y-2">
            <label htmlFor="deckhub-commander" className="text-sm font-medium">
              Commander
            </label>
            <Input
              id="deckhub-commander"
              value={filters.commander}
              placeholder="Atraxa, Muldrotha…"
              onChange={(event) => onChange({ commander: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="deckhub-card" className="text-sm font-medium">
              Contains card
            </label>
            <Input
              id="deckhub-card"
              value={filters.card}
              placeholder="Sol Ring, Lightning Bolt…"
              onChange={(event) => onChange({ card: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium">Color identity</span>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((color) => (
                <Button
                  key={color}
                  type="button"
                  variant={filters.colors.includes(color) ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={filters.colors.includes(color)}
                  onClick={() => toggleColor(color)}
                >
                  <ManaSymbols cost={`{${color}}`} size="sm" />
                </Button>
              ))}
            </div>
            <select
              value={filters.colorMatch}
              aria-label="Color identity match"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              onChange={(event) =>
                onChange({
                  colorMatch: event.target.value as DeckHubDiscoveryFilters["colorMatch"],
                })
              }
            >
              <option value="exact">Exact color identity</option>
              <option value="includes">Includes these colors</option>
            </select>
          </div>
          {facets && facets.tags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Tags</span>
                <select
                  value={filters.tagMatch}
                  aria-label="Tag match"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  onChange={(event) =>
                    onChange({
                      tagMatch: event.target.value as DeckHubDiscoveryFilters["tagMatch"],
                    })
                  }
                >
                  <option value="any">Match any</option>
                  <option value="all">Match all</option>
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                {facets.tags.map((tag) => (
                  <Button
                    key={tag.key}
                    type="button"
                    variant={filters.tags.includes(tag.key) ? "secondary" : "outline"}
                    size="sm"
                    aria-pressed={filters.tags.includes(tag.key)}
                    onClick={() => toggleTag(tag.key)}
                  >
                    {tag.label}
                    <span className="text-xs text-muted-foreground">{tag.count}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          <Button
            type="button"
            variant={filters.favorites ? "secondary" : "outline"}
            className="w-full justify-start"
            aria-pressed={filters.favorites}
            onClick={() => onChange({ favorites: !filters.favorites })}
          >
            <Heart className={cn("h-4 w-4", filters.favorites && "fill-current")} />
            My favorites
          </Button>
        </div>
        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={onClear} disabled={activeFilterCount === 0}>
            Clear all
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
