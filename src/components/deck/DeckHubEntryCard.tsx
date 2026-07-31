import { Heart, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DECK_NAME_SHADOW_CLASS } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";
import type { DeckHubEntrySummary } from "@/api/hubTypes";

interface DeckHubEntryCardProps {
  entry: DeckHubEntrySummary;
  onOpen: () => void;
  onFavorite: () => void;
}

export function DeckHubEntryCard({ entry, onOpen, onFavorite }: DeckHubEntryCardProps) {
  const colorCost = entry.colors
    .split("")
    .map((color) => `{${color}}`)
    .join("");

  return (
    <div
      className={cn(
        "group relative aspect-[4/3] overflow-hidden rounded-lg border bg-muted",
        "transition-all hover:border-primary hover:ring-2 hover:ring-primary",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
        aria-label={`Open ${entry.title} by ${entry.author}`}
      >
        {entry.coverImageUrl ? (
          <img
            src={entry.coverImageUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center">
            <Layers className="h-10 w-10 text-muted-foreground opacity-30" />
          </span>
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-overlay/80 via-overlay/20 to-overlay/10" />
        <span className="absolute bottom-0 left-0 right-0 z-10 block px-2 pb-2 pt-8">
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight text-text-on-tinted",
              DECK_NAME_SHADOW_CLASS,
            )}
          >
            {entry.title}
          </span>
          <span
            className={cn(
              "block truncate text-[11px] text-text-on-tinted/85",
              DECK_NAME_SHADOW_CLASS,
            )}
          >
            by {entry.author}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <FormatBadge formatId={entry.format ?? "commander"} />
            {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
            <span className="ml-auto text-[10px] text-text-on-tinted/85">
              {entry.cardCount} cards
            </span>
          </span>
        </span>
      </button>

      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="absolute right-1.5 top-1.5 z-20 h-8 gap-1 bg-background/90 px-2 shadow-sm backdrop-blur-sm"
        aria-label={entry.favorited ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={entry.favorited}
        onClick={onFavorite}
      >
        <Heart className={cn("h-3.5 w-3.5", entry.favorited && "fill-current text-primary")} />
        <span className="text-xs tabular-nums">{entry.favoriteCount}</span>
      </Button>

      {entry.tags.length > 0 && (
        <div className="pointer-events-none absolute left-1.5 top-1.5 z-20 flex max-w-[65%] gap-1 overflow-hidden">
          {entry.tags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="truncate rounded-full border bg-background/90 px-2 py-1 text-[10px] font-medium backdrop-blur-sm"
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
