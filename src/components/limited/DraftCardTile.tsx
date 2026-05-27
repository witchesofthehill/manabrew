import { memo } from "react";

import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { FoilBadge } from "@/components/limited/FoilBadge";
import { draftCardToManaBrew } from "@/lib/limited.utils";
import { cn } from "@/lib/utils";
import { useCard } from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";

interface DraftCardTileProps {
  card: DraftCard;
  index: number;
  onClick?: () => void;
  disabled?: boolean;
  preview?: unknown;
  overlay?: React.ReactNode;
}

function DraftCardTileImpl({ card, index, onClick, disabled, overlay }: DraftCardTileProps) {
  // The engine returns DraftCards stripped of Scryfall image data — the
  // Scryfall store hydrates uris on first lookup. While we wait, render a
  // skeleton instead of crashing the Draft view via the placeholder
  // image (DFCs' uris hang off card_faces[0]; the store normalises both
  // into the entry's top-level `uris`).
  const scry = useCard({
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
  });
  if (!scry?.uris) {
    return (
      <div className="relative w-full">
        <div className="aspect-[5/7] w-full animate-pulse rounded-lg border border-border/50 bg-muted/40" />
      </div>
    );
  }
  const omc = draftCardToManaBrew({ ...card, uris: scry.uris }, index);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group relative w-full text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-60",
        card.foil && "draft-tile-foil",
      )}
    >
      <CardThumbnail card={omc} />
      {card.isDoubleFaced && (
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
