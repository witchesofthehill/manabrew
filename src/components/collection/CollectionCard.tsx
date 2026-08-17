import type { MouseEvent } from "react";
import { ImageIcon } from "lucide-react";

import { CardThumbnail } from "@/components/editor/deckEditor.primitives";
import { Input } from "@/components/ui/input";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import type { DeckCard } from "@/protocol/deck";
import { useCard } from "@/stores/useScryfallStore";

interface CollectionCardProps {
  name: string;
  setCode?: string;
  collectorNumber?: string;
  foil?: boolean;
  quantity: number;
  view: "text" | "grid";
  onQuantityChange: (quantity: number) => void;
  onHover: (card: DeckCard, event: MouseEvent) => void;
  onLeave: () => void;
}

export function CollectionCard({
  name,
  setCode,
  collectorNumber,
  foil,
  quantity,
  view,
  onQuantityChange,
  onHover,
  onLeave,
}: CollectionCardProps) {
  const result = useCard({ name, setCode, collectorNumber });
  const baseCard = result?.info ? scryfallToDeckCard(result.info) : null;
  const card = baseCard
    ? { ...baseCard, identity: { ...baseCard.identity, foil: foil ?? false } }
    : null;
  const displayName = card?.identity.name ?? name;
  const quantityInput = (
    <Input
      type="number"
      min="0"
      className="h-8 w-20 text-right font-mono"
      value={quantity}
      aria-label={`Owned copies of ${displayName}`}
      onChange={(event) => onQuantityChange(Number(event.target.value))}
    />
  );

  if (view === "text") {
    return (
      <div
        className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0 hover:bg-muted/30"
        onMouseEnter={(event) => card && onHover(card, event)}
        onMouseLeave={onLeave}
      >
        <span className="min-w-0 flex-1 truncate">{displayName}</span>
        {setCode && collectorNumber && (
          <span className="text-xs uppercase text-muted-foreground">
            {setCode} #{collectorNumber}
          </span>
        )}
        {foil !== undefined && (
          <span className="text-[10px] font-medium text-muted-foreground">
            {foil ? "Foil" : "Non-foil"}
          </span>
        )}
        <span className="text-xs text-muted-foreground">Owned</span>
        {quantityInput}
      </div>
    );
  }

  return (
    <article
      className="group min-w-0"
      onMouseEnter={(event) => card && onHover(card, event)}
      onMouseLeave={onLeave}
    >
      <div className="aspect-[5/7] overflow-hidden rounded-lg border border-border/70 bg-muted/40 shadow-sm transition-[border-color,transform] group-hover:-translate-y-0.5 group-hover:border-primary/60">
        {card ? (
          <CardThumbnail card={card} loading="lazy" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">Loading {name}…</span>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="min-w-0 flex-1" title={displayName}>
          <span className="block truncate text-sm font-medium">{displayName}</span>
          {setCode && collectorNumber && (
            <span className="block truncate text-[10px] uppercase text-muted-foreground">
              {setCode} #{collectorNumber}
            </span>
          )}
          {foil !== undefined && (
            <span className="block text-[10px] text-muted-foreground">
              {foil ? "Foil" : "Non-foil"}
            </span>
          )}
        </span>
        {quantityInput}
      </div>
    </article>
  );
}
