import { Button } from "@/components/ui/button";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import { LimitedDeckStats } from "@/components/limited/LimitedDeckStats";
import type { useCardPreview } from "@/hooks/useCardPreview";
import type { DraftCard } from "@/types/limited";

interface DraftPoolPanelProps {
  cards: DraftCard[];
  preview: ReturnType<typeof useCardPreview>;
  onBuild?: () => void;
}

export function DraftPoolPanel({ cards, preview, onBuild }: DraftPoolPanelProps) {
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/70 bg-card/20">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Picks ({cards.length})
        </h2>
        {onBuild && cards.length > 0 && (
          <Button size="sm" variant="outline" onClick={onBuild} className="h-7 text-xs">
            Build
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <LimitedDeckStats cards={cards} compact />
        {cards.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Your picks and live deck analysis appear here.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-3">
            {cards.map((card, index) => (
              <DraftCardTile
                key={`${card.name}:${card.setCode}:${card.cardNumber}:${index}`}
                card={card}
                index={index}
                preview={preview}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
