import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { SetStudyPicker } from "@/components/editor/SetStudyPicker";
import { MAX_CARD_SIZE } from "@/components/editor/deckBuilder.utils";
import { ScryfallImg } from "@/components/ScryfallImg";
import { manaSymbolUrl } from "@/api/scryfall";
import type { ManaCode } from "@/types/scryfall";

interface SetStudyToolbarProps {
  setCode: string;
  onSetChange: (code: string) => void;
  colors: ReadonlyArray<{ id: string; title: string }>;
  activeColors: Set<string>;
  onColorToggle: (color: string) => void;
  onClearColors: () => void;
  rarities: Set<string>;
  onRaritiesChange: (rarities: Set<string>) => void;
  sort: string;
  onSortChange: (sort: string) => void;
  sortOptions: ReadonlyArray<{ id: string; label: string }>;
  cardSize: number;
  onCardSizeChange: (size: number) => void;
  grid: boolean;
  onReset: () => void;
}

const RARITY_GROUPS = [
  { label: "All rarities", values: [] },
  { label: "Commons & uncommons", values: ["common", "uncommon"] },
  { label: "Rares & mythics", values: ["rare", "mythic"] },
];

export function SetStudyToolbar({
  setCode,
  onSetChange,
  colors,
  activeColors,
  onColorToggle,
  onClearColors,
  rarities,
  onRaritiesChange,
  sort,
  onSortChange,
  sortOptions,
  cardSize,
  onCardSizeChange,
  grid,
  onReset,
}: SetStudyToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <p className="text-sm font-semibold">Study a set</p>
          <p className="text-xs text-muted-foreground">Get ready for draft or prerelease.</p>
        </div>
        <SetStudyPicker value={setCode} onChange={onSetChange} />
      </div>
      {setCode && (
        <div className="space-y-3">
          <Button
            variant={expanded ? "selected" : "outline"}
            size="sm"
            className="sm:hidden"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide study filters" : "Study filters"}
            {(activeColors.size > 0 || rarities.size > 0) && " · Active"}
          </Button>
          <div className={cn("space-y-3", !expanded && "hidden sm:block")}>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant={activeColors.size === 0 ? "selected" : "outline"}
                size="sm"
                onClick={onClearColors}
              >
                All colors
              </Button>
              {colors.map(({ id, title }) => (
                <Button
                  key={id}
                  variant={activeColors.has(id) ? "selected" : "outline"}
                  size="icon-sm"
                  title={title}
                  aria-label={title}
                  aria-pressed={activeColors.has(id)}
                  onClick={() => onColorToggle(id)}
                >
                  {id === "M" ? (
                    <span className="text-xs">M</span>
                  ) : (
                    <ScryfallImg src={manaSymbolUrl(id as ManaCode)} alt="" className="h-4 w-4" />
                  )}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {RARITY_GROUPS.map(({ label, values }) => (
                <Button
                  key={label}
                  variant={
                    rarities.size === values.length && values.every((value) => rarities.has(value))
                      ? "selected"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => onRaritiesChange(new Set(values))}
                >
                  {label}
                </Button>
              ))}
              <Button variant="ghost" size="sm" onClick={onReset}>
                Reset filters
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSetChange("")}>
                All sets
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Sort
          <select
            value={sort || "cmc"}
            onChange={(event) => onSortChange(event.target.value)}
            className="h-8 w-28 rounded-md border bg-background px-2 text-xs text-foreground pointer-coarse:h-10 pointer-coarse:text-base"
          >
            {sortOptions.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {grid && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Card size
            <input
              type="range"
              min={1}
              max={MAX_CARD_SIZE}
              step={1}
              value={cardSize}
              onChange={(event) => onCardSizeChange(Number(event.target.value))}
              className="h-8 w-24 cursor-pointer accent-primary pointer-coarse:h-10 sm:w-28"
            />
          </label>
        )}
      </div>
      {setCode && (
        <p className="hidden text-xs text-muted-foreground sm:block">
          Tap a card to read it. Set listings can include cards outside draft boosters.
        </p>
      )}
    </div>
  );
}
