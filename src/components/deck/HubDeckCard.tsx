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
  const cardCount = deck.cardCount + deck.commanders.length;
  const colorCost = deck.colors
    .split("")
    .map((color) => `{${color}}`)
    .join("");

  return (
    <div
      className={cn(
        "relative group overflow-hidden rounded-lg border bg-muted",
        "aspect-[4/3] transition-all hover:border-primary hover:ring-2 hover:ring-primary",
      )}
    >
      <button
        type="button"
        className="absolute inset-0 w-full cursor-pointer rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
        aria-label={`Open ${deck.name} by ${deck.author}`}
      >
        {deck.coverImageUrl ? (
          <img
            src={deck.coverImageUrl}
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

        <span className="absolute bottom-0 left-0 right-0 z-10 block px-2 pb-2 pt-6">
          <span
            className={cn(
              "block truncate text-sm font-semibold leading-tight text-text-on-tinted",
              DECK_NAME_SHADOW_CLASS,
            )}
          >
            {deck.name}
          </span>
          <span
            className={cn(
              "block truncate text-[11px] text-text-on-tinted/85",
              DECK_NAME_SHADOW_CLASS,
            )}
          >
            by {deck.author}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            <FormatBadge formatId={deck.format ?? "commander"} />
            {colorCost && <ManaSymbols cost={colorCost} size="sm" />}
            <span className="ml-auto text-[10px] text-text-on-tinted/85">{cardCount} cards</span>
          </span>
        </span>
      </button>
    </div>
  );
}
