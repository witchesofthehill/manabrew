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
      className="w-20 shrink-0 text-right font-mono non-touch:h-8"
      value={quantity}
      aria-label={`Owned copies of ${displayName}`}
      onChange={(event) => onQuantityChange(Number(event.target.value))}
    />
  );
  if (view === "text") {
    return (
      <div
        className="flex min-w-0 items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/30 non-touch:gap-4"
        onMouseEnter={(event) => card && onHover(card, event)}
        onMouseLeave={onLeave}
      >
        <div className="min-w-0 flex-1 non-touch:contents">
          <span
            className="block truncate text-ui-label non-touch:min-w-0 non-touch:flex-1 non-touch:text-[length:inherit] non-touch:leading-[inherit]"
            title={displayName}
          >
            {displayName}
          </span>
          <div className="flex flex-wrap gap-x-3 text-ui-meta text-muted-foreground non-touch:contents non-touch:text-[10px] non-touch:leading-[inherit]">
            {setCode && collectorNumber && (
              <span className="break-words uppercase non-touch:text-xs">
                {setCode} #{collectorNumber}
              </span>
            )}
            {foil !== undefined && <span>{foil ? `Foil` : `Non-foil`}</span>}
          </div>
        </div>
        <label className="flex shrink-0 flex-col gap-1 text-ui-meta text-muted-foreground non-touch:contents non-touch:text-xs">
          Owned
          {quantityInput}
        </label>
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
            <span className="text-ui-meta non-touch:text-xs">Loading {name}…</span>
          </div>
        )}
      </div>
      <div className="mt-2 space-y-2 non-touch:flex non-touch:items-center non-touch:space-y-0 non-touch:gap-2">
        <span className="block min-w-0 non-touch:flex-1" title={displayName}>
          <span className="block truncate text-ui-label font-medium non-touch:text-sm">
            {displayName}
          </span>
          {setCode && collectorNumber && (
            <span className="block break-words text-ui-meta uppercase text-muted-foreground non-touch:text-[10px] non-touch:leading-[inherit]">
              {setCode} #{collectorNumber}
            </span>
          )}
          {foil !== undefined && (
            <span className="block text-ui-meta text-muted-foreground non-touch:text-[10px] non-touch:leading-[inherit]">
              {foil ? `Foil` : `Non-foil`}
            </span>
          )}
        </span>
        <label className="flex flex-wrap items-center justify-between gap-2 text-ui-meta text-muted-foreground non-touch:contents">
          <span className="non-touch:hidden">Owned</span>
          {quantityInput}
        </label>
      </div>
    </article>
  );
}
