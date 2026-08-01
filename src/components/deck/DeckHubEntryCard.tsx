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
  onFavorite?: () => void;
  favoritePending?: boolean;
  variant?: "grid" | "list";
}

export function DeckHubEntryCard({
  entry,
  onOpen,
  onFavorite,
  favoritePending = false,
  variant = "grid",
}: DeckHubEntryCardProps) {
  const colorCost = entry.colors
    .split("")
    .map((color) => `{${color}}`)
    .join("");
  const discoveryTags = entry.tags.filter(
    (tag) => tag.slug !== "official" && tag.slug !== "preset",
  );

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted",
        variant === "grid" ? "aspect-[4/3]" : "h-32 sm:h-36",
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
            className={cn(
              "absolute h-full object-cover",
              variant === "grid" ? "inset-0 w-full" : "inset-y-0 left-0 w-32 sm:w-48",
            )}
          />
        ) : (
          <span
            className={cn(
              "absolute inset-y-0 left-0 flex items-center justify-center",
              variant === "grid" ? "inset-x-0" : "w-32 sm:w-48",
            )}
          >
            <Layers className="h-10 w-10 text-muted-foreground opacity-30" />
          </span>
        )}
        <span
          className={cn(
            "absolute inset-0",
            variant === "grid"
              ? "bg-gradient-to-t from-overlay/80 via-overlay/20 to-overlay/10"
              : "bg-gradient-to-r from-overlay/30 via-background/95 to-background",
          )}
        />
        <span
          className={cn(
            "absolute z-10 block",
            variant === "grid"
              ? "bottom-0 left-0 right-0 px-2 pb-2 pt-8"
              : "inset-y-0 left-32 right-0 flex flex-col justify-center px-3 pr-14 sm:left-48 sm:px-4",
          )}
        >
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight text-text-on-tinted",
              variant === "list" && "text-base text-foreground",
              variant === "grid" && DECK_NAME_SHADOW_CLASS,
            )}
          >
            {entry.title}
          </span>
          <span
            className={cn(
              "block truncate text-[11px] text-text-on-tinted/85",
              variant === "list" && "mt-1 text-xs text-muted-foreground",
              variant === "grid" && DECK_NAME_SHADOW_CLASS,
            )}
          >
            by {entry.author}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <FormatBadge formatId={entry.format ?? "commander"} />
            {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
            <span className="ml-auto text-[10px] text-text-on-tinted/85">
              <span className={cn(variant === "list" && "text-muted-foreground")}>
                {entry.cardCount} cards
              </span>
            </span>
          </span>
          {variant === "list" && entry.summary && (
            <span className="mt-2 line-clamp-1 text-xs text-muted-foreground">{entry.summary}</span>
          )}
        </span>
      </button>

      {onFavorite ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute right-1.5 top-1.5 z-20 h-8 gap-1 bg-background/90 px-2 shadow-sm backdrop-blur-sm"
          aria-label={entry.favorited ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={entry.favorited}
          aria-busy={favoritePending}
          disabled={favoritePending}
          onClick={onFavorite}
        >
          <Heart className={cn("h-3.5 w-3.5", entry.favorited && "fill-current text-primary")} />
          {entry.favoriteCount > 0 && (
            <span className="text-xs tabular-nums">{entry.favoriteCount}</span>
          )}
        </Button>
      ) : entry.favoriteCount > 0 ? (
        <span className="absolute right-1.5 top-1.5 z-20 flex h-8 items-center gap-1 rounded-md bg-background/90 px-2 text-xs shadow-sm backdrop-blur-sm">
          <Heart className="h-3.5 w-3.5" />
          <span className="tabular-nums">{entry.favoriteCount}</span>
        </span>
      ) : null}

      {variant === "grid" && discoveryTags.length > 0 && (
        <div
          className={cn(
            "pointer-events-none absolute left-1.5 z-20 flex max-w-[65%] gap-1 overflow-hidden",
            entry.sourceKind === "preset" ? "top-10" : "top-1.5",
          )}
        >
          {discoveryTags.slice(0, 2).map((tag) => (
            <span
              key={tag.id}
              className="truncate rounded-full border bg-background/90 px-2 py-1 text-[10px] font-medium backdrop-blur-sm"
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
      {entry.sourceKind === "preset" && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded-full border bg-background/90 px-2 py-1 text-[10px] font-medium backdrop-blur-sm">
          Official preset
        </span>
      )}
    </div>
  );
}
