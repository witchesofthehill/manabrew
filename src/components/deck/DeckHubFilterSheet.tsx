import { useEffect, useRef, useState } from "react";
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
import { MANA_LETTERS } from "@/themes/gameTheme";
import { cn } from "@/lib/utils";

const FILTER_DEBOUNCE_MS = 300;

interface DeckHubFilterSheetProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  activeFilterCount: number;
  favoritesEnabled: boolean;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilterSheet({
  filters,
  facets,
  activeFilterCount,
  favoritesEnabled,
  onChange,
  onClear,
}: DeckHubFilterSheetProps) {
  const [commander, setCommander] = useState(filters.commander);
  const [card, setCard] = useState(filters.card);
  const [synced, setSynced] = useState({ commander: filters.commander, card: filters.card });
  const onChangeRef = useRef(onChange);

  if (synced.commander !== filters.commander || synced.card !== filters.card) {
    setSynced({ commander: filters.commander, card: filters.card });
    setCommander(filters.commander);
    setCard(filters.card);
  }

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const patch: Partial<DeckHubDiscoveryFilters> = {};
    if (commander !== filters.commander) patch.commander = commander;
    if (card !== filters.card) patch.card = card;
    if (Object.keys(patch).length === 0) return;
    const timer = setTimeout(() => onChangeRef.current(patch), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [commander, card, filters.commander, filters.card]);

  const userTags = facets?.tags.filter((tag) => tag.key !== "official" && tag.key !== "preset");
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
      : MANA_LETTERS.filter((item) => item !== "C" && [...selected, color].includes(item));
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
          <SheetTitle>Refine the Deck Hub</SheetTitle>
          <SheetDescription>
            Combine filters to find a published deck and inspect its exact card snapshot.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto py-4">
          <div className="space-y-2">
            <span className="text-sm font-medium">Source</span>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["all", "All"],
                  ["community", "Community"],
                  ["presets", "Presets"],
                ] as const
              ).map(([source, label]) => (
                <Button
                  key={source}
                  type="button"
                  variant={filters.source === source ? "secondary" : "outline"}
                  size="sm"
                  aria-pressed={filters.source === source}
                  onClick={() => onChange({ source })}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label htmlFor="deckhub-commander" className="text-sm font-medium">
              Commander
            </label>
            <Input
              id="deckhub-commander"
              value={commander}
              placeholder="Atraxa, Muldrotha…"
              onChange={(event) => setCommander(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="deckhub-card" className="text-sm font-medium">
              Contains card
            </label>
            <Input
              id="deckhub-card"
              value={card}
              placeholder="Sol Ring, Lightning Bolt…"
              onChange={(event) => setCard(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <span className="text-sm font-medium">Color identity</span>
            <div className="flex flex-wrap gap-2">
              {MANA_LETTERS.map((color) => (
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
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm pointer-coarse:text-base"
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
          {userTags && userTags.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Tags</span>
                <select
                  value={filters.tagMatch}
                  aria-label="Tag match"
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs pointer-coarse:text-base"
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
                {userTags.map((tag) => (
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
          {favoritesEnabled && (
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
          )}
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
