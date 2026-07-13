import { Layers } from "lucide-react";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DECK_NAME_SHADOW_CLASS } from "@/components/deck/deckDisplay.utils";
import { cn } from "@/lib/utils";
import type { HubDeckSummary } from "@/api/hubTypes";

interface HubDeckCardProps {
  deck: HubDeckSummary;
  onOpen: () => void;
}

export function HubDeckCard({ deck, onOpen }: HubDeckCardProps) {
  const colorCost = deck.colors
    .split("")
    .map((color) => `{${color}}`)
    .join("");

  return (
    <div
      className={cn(
        "relative group cursor-pointer rounded-lg overflow-hidden border bg-muted",
        "aspect-[4/3] transition-all hover:ring-2 hover:ring-primary hover:border-primary",
      )}
      onClick={onOpen}
    >
      {deck.coverImageUrl ? (
        <img
          src={deck.coverImageUrl}
          alt={deck.coverCardName ?? deck.name}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <Layers className="h-10 w-10 text-muted-foreground opacity-30" />
        </div>
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />

      <div className="absolute bottom-0 left-0 right-0 px-2 pt-6 pb-2 z-10">
        <p
          className={cn(
            "text-white text-sm font-semibold truncate leading-tight",
            DECK_NAME_SHADOW_CLASS,
          )}
        >
          {deck.name}
        </p>
        <p className={cn("text-white/85 text-[11px] truncate", DECK_NAME_SHADOW_CLASS)}>
          by {deck.author}
        </p>
        <div className="flex items-center gap-1 mt-1 flex-wrap">
          <FormatBadge formatId={deck.format ?? "commander"} />
          {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
          <span className="ml-auto text-[10px] text-white/85">{deck.cardCount} cards</span>
        </div>
      </div>
    </div>
  );
}
