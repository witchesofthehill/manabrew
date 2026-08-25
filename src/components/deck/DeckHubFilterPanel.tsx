import { useEffect, useRef, useState } from "react";
import { Heart, Search, X } from "lucide-react";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DeckHubDiscoveryFilters } from "@/components/deck/deckHub.types";
import type { DeckHubFacets } from "@/api/hubTypes";
import { FORMAT_DISPLAY } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { MANA_LETTERS } from "@/themes/gameTheme";

const DEFAULT_FORMATS = [
  "commander",
  "standard",
  "pioneer",
  "modern",
  "pauper",
  "premodern",
  "brawl",
];
const FILTER_DEBOUNCE_MS = 300;

interface DeckHubFilterPanelProps {
  filters: DeckHubDiscoveryFilters;
  facets: DeckHubFacets | null;
  activeFilterCount: number;
  favoritesEnabled: boolean;
  onChange: (patch: Partial<DeckHubDiscoveryFilters>) => void;
  onClear: () => void;
}

export function DeckHubFilterPanel({
  filters,
  facets,
  activeFilterCount,
  favoritesEnabled,
  onChange,
  onClear,
}: DeckHubFilterPanelProps) {
  const [commander, setCommander] = useState(filters.commander);
  const [card, setCard] = useState(filters.card);
  const [synced, setSynced] = useState({ commander: filters.commander, card: filters.card });
  const onChangeRef = useRef(onChange);
  const formats = facets?.formats.length ? facets.formats.map((item) => item.key) : DEFAULT_FORMATS;
  const userTags = facets?.tags.filter((tag) => tag.key !== "official" && tag.key !== "preset");

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
  }, [card, commander, filters.card, filters.commander]);

  const toggleFormat = (format: string) =>
    onChange({
      formats: filters.formats.includes(format)
        ? filters.formats.filter((item) => item !== format)
        : [...filters.formats, format],
    });
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
    <div className="space-y-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filters.search}
          onChange={(event) => onChange({ search: event.target.value })}
          aria-label="Search Community"
          placeholder="Search decks or authors"
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

      <div className="grid grid-cols-2 gap-2">
        <select
          value={filters.sort}
          aria-label="Sort Community decks"
          className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:text-base"
          onChange={(event) =>
            onChange({ sort: event.target.value as DeckHubDiscoveryFilters["sort"] })
          }
        >
          <option value="newest">Newest</option>
          <option value="name">Name</option>
          <option value="favorites">Favorites</option>
        </select>
        <select
          value={filters.group}
          aria-label="Group Community results"
          className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm pointer-coarse:text-base"
          onChange={(event) =>
            onChange({ group: event.target.value as DeckHubDiscoveryFilters["group"] })
          }
        >
          <option value="none">No groups</option>
          <option value="source">By source</option>
          <option value="format">By format</option>
          <option value="color">By color</option>
          <option value="tag">By tag</option>
        </select>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Source</span>
        <div className="grid grid-cols-3 gap-2">
          {(["all", "community", "presets"] as const).map((source) => (
            <Button
              key={source}
              type="button"
              variant={filters.source === source ? "secondary" : "outline"}
              size="sm"
              aria-pressed={filters.source === source}
              onClick={() => onChange({ source })}
            >
              {source === "all" ? "All" : source === "community" ? "Community" : "Presets"}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium">Formats</span>
        <div className="flex flex-wrap gap-1.5">
          {formats.map((format) => (
            <Button
              key={format}
              type="button"
              variant={filters.formats.includes(format) ? "secondary" : "outline"}
              size="sm"
              aria-pressed={filters.formats.includes(format)}
              onClick={() => toggleFormat(format)}
            >
              {FORMAT_DISPLAY[format] ?? format}
            </Button>
          ))}
        </div>
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
            onChange({ colorMatch: event.target.value as DeckHubDiscoveryFilters["colorMatch"] })
          }
        >
          <option value="exact">Exact colors</option>
          <option value="includes">Includes colors</option>
        </select>
      </div>

      <div className="grid gap-3">
        <Input
          value={commander}
          aria-label="Commander"
          placeholder="Commander"
          onChange={(event) => setCommander(event.target.value)}
        />
        <Input
          value={card}
          aria-label="Contains card"
          placeholder="Contains card"
          onChange={(event) => setCard(event.target.value)}
        />
      </div>

      {userTags && userTags.length > 0 && (
        <div className="space-y-2">
          <span className="text-sm font-medium">Tags</span>
          <div className="flex flex-wrap gap-1.5">
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
      <Button
        variant="ghost"
        className="w-full"
        onClick={onClear}
        disabled={activeFilterCount === 0}
      >
        Clear all filters
      </Button>
    </div>
  );
}
