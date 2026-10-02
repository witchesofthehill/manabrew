import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { CMC_BUCKET_LABELS } from "@/components/editor/deckBuilder.utils";
import { cn } from "@/lib/utils";
import { MANA_LETTERS } from "@/themes/gameTheme";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import { buildDeck } from "@/components/limited/useLimitedBuildStore";
import type { BuildGroup, BuildSession } from "@/components/limited/useLimitedBuildStore";
export interface BuildFilters {
  search: string;
  colors: string[];
  type: string;
  manaValue?: number | null;
}
interface Props {
  filters: BuildFilters;
  onChange: (filters: BuildFilters) => void;
  session: BuildSession;
  onPreferences: (prefs: Partial<Pick<BuildSession, "group" | "cardSize" | "mode">>) => void;
  presentation?: "dialog" | "toolbar";
}
export function LimitedBuildFilters({
  filters,
  onChange,
  session,
  onPreferences,
  presentation = "dialog",
}: Props) {
  const deck = buildDeck(session);
  const sideboardCount = session.allocation.sideboardIds.length;
  const maybeCount = session.allocation.maybeIds.length;
  const toolbar = presentation === "toolbar";
  const hasFilters = Boolean(
    filters.search || filters.colors.length || filters.type !== "all" || filters.manaValue != null,
  );
  const quickFilters = (
    <>
      <div className={cn("relative min-w-0", toolbar ? "flex-1 basis-48" : "col-span-2")}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search acquired cards"
          placeholder="Search acquired cards"
          value={filters.search}
          onChange={(event) => onChange({ ...filters, search: event.target.value })}
          className="h-9 pl-9 pr-9 text-xs pointer-coarse:h-11 pointer-coarse:text-base"
        />
        {filters.search && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear acquired card search"
            className="absolute right-0 top-0 h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11"
            onClick={() => onChange({ ...filters, search: "" })}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div
        className={cn(
          "flex flex-wrap items-center gap-1 rounded-md border bg-background p-1",
          !toolbar && "col-span-2",
        )}
        aria-label="Color filters"
      >
        {[...MANA_LETTERS, "M"].map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`Filter ${color === "M" ? "multicolor" : color === "C" ? "colorless" : color}`}
            aria-pressed={filters.colors.includes(color)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded text-xs opacity-45 transition-opacity hover:opacity-80 pointer-coarse:h-11 pointer-coarse:w-11",
              filters.colors.includes(color) && "bg-selection/15 opacity-100 ring-1 ring-selection",
            )}
            onClick={() =>
              onChange({
                ...filters,
                colors: filters.colors.includes(color)
                  ? filters.colors.filter((item) => item !== color)
                  : [...filters.colors, color],
              })
            }
          >
            {color === "M" ? (
              "Multi"
            ) : (
              <ManaSymbols cost={`{${color}}`} size="sm" className="m-0" />
            )}
          </button>
        ))}
      </div>
      <AppSelect
        aria-label="Card type filter"
        value={filters.type}
        onValueChange={(type) => onChange({ ...filters, type })}
        className="h-9 w-auto min-w-32 text-xs pointer-coarse:h-11 pointer-coarse:text-base"
      >
        <AppSelectOption value="all">All types</AppSelectOption>
        {[
          "Creature",
          "Land",
          "Instant",
          "Sorcery",
          "Artifact",
          "Enchantment",
          "Planeswalker",
          "Conspiracy",
        ].map((type) => (
          <AppSelectOption key={type} value={type}>
            {type}
          </AppSelectOption>
        ))}
      </AppSelect>
      {filters.manaValue != null && (
        <Button
          variant="selected"
          size="sm"
          aria-label="Clear mana value filter"
          onClick={() => onChange({ ...filters, manaValue: null })}
        >
          {CMC_BUCKET_LABELS[filters.manaValue]} mana <X className="h-3 w-3" />
        </Button>
      )}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ search: "", colors: [], type: "all", manaValue: null })}
        >
          Clear filters
        </Button>
      )}
    </>
  );
  return (
    <div className={cn(toolbar && "flex flex-wrap items-center gap-2")}>
      {toolbar && quickFilters}
      <Dialog>
        <DialogTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={
              toolbar
                ? "Display settings and deck statistics"
                : "Filters, display settings and deck statistics"
            }
          >
            {toolbar && <SlidersHorizontal className="h-3.5 w-3.5" />}
            {toolbar ? "Display" : "Filters"}
            {!toolbar && hasFilters && " · Active"}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{toolbar ? "Display & statistics" : "Filters & display"}</DialogTitle>
            <DialogDescription>
              {toolbar
                ? "Arrange the table or review your mainboard."
                : "Search your acquired cards, arrange the table, or review your mainboard."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 items-center gap-2">
            {!toolbar && quickFilters}
            <AppSelect
              aria-label="Group cards"
              value={session.group}
              onValueChange={(group) => onPreferences({ group: group as BuildGroup })}
              className="h-9"
            >
              <AppSelectOption value="none">No grouping</AppSelectOption>
              <AppSelectOption value="color">Color</AppSelectOption>
              <AppSelectOption value="cmc">Mana value</AppSelectOption>
              <AppSelectOption value="type">Type</AppSelectOption>
              <AppSelectOption value="rarity">Rarity</AppSelectOption>
            </AppSelect>
            <AppSelect
              aria-label="Card size"
              value={String(session.cardSize)}
              onValueChange={(size) => onPreferences({ cardSize: Number(size) })}
              className="h-9"
            >
              <AppSelectOption value="90">Small</AppSelectOption>
              <AppSelectOption value="130">Medium</AppSelectOption>
              <AppSelectOption value="170">Large</AppSelectOption>
            </AppSelect>
            <Button
              variant={session.mode === "gallery" ? "selected" : "outline"}
              size="sm"
              aria-pressed={session.mode === "gallery"}
              onClick={() => onPreferences({ mode: "gallery" })}
            >
              Gallery
            </Button>
            <Button
              variant={session.mode === "list" ? "selected" : "outline"}
              size="sm"
              aria-pressed={session.mode === "list"}
              onClick={() => onPreferences({ mode: "list" })}
            >
              List
            </Button>
          </div>
          <section className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-medium">Mainboard statistics</h3>
            <p className="text-xs tabular-nums text-muted-foreground">
              Pool {deck.sideboard.length - sideboardCount - maybeCount} · Sideboard{" "}
              {sideboardCount} · Maybeboard {maybeCount}
            </p>
            <p className="text-xs text-muted-foreground">
              The complete exported sideboard contains all {deck.sideboard.length} cards outside the
              Mainboard.
            </p>
            <LimitedDeckStats cards={deck.main} />
          </section>
        </DialogContent>
      </Dialog>
    </div>
  );
}
