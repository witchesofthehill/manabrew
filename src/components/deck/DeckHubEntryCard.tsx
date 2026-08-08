import { Heart, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeckCardSurface } from "@/components/deck/DeckCardSurface";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { cn } from "@/lib/utils";
import type { DeckHubEntrySummary } from "@/api/hubTypes";

interface DeckHubEntryCardProps {
  entry: DeckHubEntrySummary;
  onOpen: () => void;
  onFavorite?: () => void;
  favoritePending?: boolean;
  variant?: "card" | "hero" | "list";
}

export function DeckHubEntryCard({
  entry,
  onOpen,
  onFavorite,
  favoritePending = false,
  variant = "card",
}: DeckHubEntryCardProps) {
  const colorCost = entry.colors
    .split("")
    .map((color) => `{${color}}`)
    .join("");
  const discoveryTags = entry.tags.filter(
    (tag) => tag.slug !== "official" && tag.slug !== "preset",
  );

  const favorite = onFavorite ? (
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
  ) : null;
  const labels = (
    <div className="pointer-events-none flex max-w-full items-center gap-1 overflow-hidden">
      {entry.sourceKind === "preset" && (
        <span className="shrink-0 whitespace-nowrap rounded-full border bg-background/90 px-2 py-1 text-[10px] font-medium backdrop-blur-sm">
          Official preset
        </span>
      )}
      {variant !== "list" && discoveryTags.length > 0 && (
        <div className="flex min-w-0 gap-1 overflow-hidden">
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
    </div>
  );

  return (
    <DeckCardSurface
      title={entry.title}
      subtitle={`by ${entry.author}`}
      description={entry.summary}
      ariaLabel={`Open ${entry.title} by ${entry.author}`}
      onOpen={onOpen}
      variant={variant}
      cover={
        entry.coverImageUrl ? (
          <img
            src={entry.coverImageUrl}
            alt=""
            loading="lazy"
            className={cn(
              "absolute h-full object-cover",
              variant === "list" ? "inset-y-0 left-0 w-32 sm:w-48" : "inset-0 w-full",
            )}
          />
        ) : (
          <span
            className={cn(
              "absolute flex items-center justify-center",
              variant === "list" ? "inset-y-0 left-0 w-32 sm:w-48" : "inset-0",
            )}
          >
            <Layers className="h-10 w-10 text-muted-foreground opacity-30" />
          </span>
        )
      }
      topLeft={labels}
      topRight={favorite}
      footer={
        <>
          <FormatBadge formatId={entry.format ?? "commander"} />
          {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
          {entry.engines?.map((engine) => (
            <span
              key={engine}
              className="rounded-full border border-border/70 bg-background/80 px-1.5 py-0.5 text-[9px] font-medium text-foreground backdrop-blur-sm"
            >
              {engine} engine
            </span>
          ))}
          <span
            className={cn(
              "ml-auto text-[10px] text-text-on-tinted/85",
              variant === "list" && "text-muted-foreground",
            )}
          >
            {entry.cardCount} cards
          </span>
        </>
      }
    />
  );
}
