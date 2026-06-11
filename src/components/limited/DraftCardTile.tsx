import { memo } from "react";

import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { FoilBadge } from "@/components/limited/FoilBadge";
import type { useCardPreview } from "@/hooks/useCardPreview";
import { useDeckCard } from "@/lib/limited.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
import type { GameCard } from "@/types/manabrew";

interface DraftCardTileProps {
  card: DraftCard;
  index: number;
  onClick?: () => void;
  disabled?: boolean;
  preview?: ReturnType<typeof useCardPreview>;
  overlay?: React.ReactNode;
}

function DraftCardTileImpl({
  card,
  index,
  onClick,
  disabled,
  preview,
  overlay,
}: DraftCardTileProps) {
  const deckCard = useDeckCard(card, index);
  if (!deckCard) {
    return (
      <div className="relative w-full">
        <div className="aspect-[5/7] w-full animate-pulse rounded-lg border border-border/50 bg-muted/40" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={(e) =>
        preview?.handleMouseEnter(deckCard as unknown as GameCard, e, { useDelay: true })
      }
      onMouseLeave={() => preview?.handleMouseLeave()}
      className={cn(
        "group relative w-full text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60",
        card.foil && "draft-tile-foil",
      )}
    >
      <CardThumbnail card={deckCard} />
      {deckCard.isDoubleFaced && (
        <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center rounded-full border border-white/20 bg-black/70 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/90">
          DFC
        </span>
      )}
      {card.foil && <FoilBadge />}
      {overlay}
    </button>
  );
}

export const DraftCardTile = memo(DraftCardTileImpl);
