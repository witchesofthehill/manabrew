import { Heart, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScryfallImg } from "@/components/ScryfallImg";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DeckTile } from "@/components/deck/DeckTile";
import { DECK_TILE_PILL_CLASS } from "@/components/deck/DeckTileFace";
import { getColorsNameClass } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";
import type { DeckHubEntrySummary } from "@/api/hubTypes";

interface DeckHubEntryCardProps {
  entry: DeckHubEntrySummary;
  onOpen: () => void;
  onPlay?: () => void;
  onFavorite?: () => void;
  favoritePending?: boolean;
  variant?: "grid" | "list";
}

export function DeckHubEntryCard({
  entry,
  onOpen,
  onPlay,
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

  const badges = (
    <>
      {entry.sourceKind === "preset" && (
        <span className={DECK_TILE_PILL_CLASS}>Official preset</span>
      )}
      {entry.engines?.map((engine) => (
        <span key={engine} className={DECK_TILE_PILL_CLASS}>
          {engine} engine
        </span>
      ))}
      {discoveryTags.slice(0, 2).map((tag) => (
        <span key={tag.id} className={cn(DECK_TILE_PILL_CLASS, "max-w-24 truncate")}>
          {tag.name}
        </span>
      ))}
    </>
  );

  const favoriteAction = onFavorite ? (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      className="h-8 gap-1 bg-background/90 px-2 shadow-sm backdrop-blur-sm"
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
    <span className="flex h-8 items-center gap-1 rounded-md bg-background/90 px-2 text-xs shadow-sm backdrop-blur-sm">
      <Heart className="h-3.5 w-3.5" />
      <span className="tabular-nums">{entry.favoriteCount}</span>
    </span>
  ) : undefined;

  if (variant === "list") {
    return (
      <div className="group relative h-32 overflow-hidden rounded-lg border bg-muted transition-all hover:border-primary hover:ring-2 hover:ring-primary sm:h-36">
        <button
          type="button"
          className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={onOpen}
          aria-label={`Open ${entry.title} by ${entry.author}`}
        >
          {entry.coverImageUrl ? (
            <ScryfallImg
              src={entry.coverImageUrl}
              alt=""
              loading="lazy"
              className="absolute inset-y-0 left-0 h-full w-32 object-cover sm:w-48"
            />
          ) : (
            <span className="absolute inset-y-0 left-0 flex w-32 items-center justify-center sm:w-48">
              <Layers className="h-10 w-10 text-muted-foreground opacity-30" />
            </span>
          )}
          <span className="absolute inset-0 bg-gradient-to-r from-overlay/30 via-background/95 to-background" />
          <span className="absolute inset-y-0 left-32 right-0 z-10 flex flex-col justify-center px-3 pr-14 sm:left-48 sm:px-4">
            <span className="block truncate text-base font-semibold leading-tight text-foreground">
              {entry.title}
            </span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              by {entry.author}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1">
              <FormatBadge formatId={entry.format ?? "commander"} />
              {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
              {badges}
              <span className="ml-auto text-[10px] text-muted-foreground">
                {entry.cardCount} cards
              </span>
            </span>
            {entry.summary && (
              <span className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                {entry.summary}
              </span>
            )}
          </span>
        </button>
        {favoriteAction && (
          <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1">
            {favoriteAction}
          </div>
        )}
      </div>
    );
  }

  return (
    <DeckTile
      title={entry.title}
      titleClassName={getColorsNameClass(entry.colors)}
      subtitle={`by ${entry.author}`}
      openLabel={`Open ${entry.title} by ${entry.author}`}
      coverUrl={entry.coverImageUrl}
      formatId={entry.format ?? "commander"}
      colorCost={colorCost}
      cardCount={entry.cardCount}
      badges={badges}
      actions={favoriteAction}
      onOpen={onOpen}
      onPlay={onPlay}
      playLabel={`Play ${entry.title}`}
    />
  );
}
