import type { ReactNode } from "react";

import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import type { PreviewCard } from "@/lib/cardPreview";

export function CardPreviewDetails({
  card,
  children,
}: {
  card: PreviewCard;
  children?: ReactNode;
}) {
  const typeLine = [
    card.supertypes?.join(" "),
    card.types?.join(" "),
    card.subtypes?.length ? `— ${card.subtypes.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pt-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold leading-tight">{card.identity.name}</span>
        {card.manaCost && (
          <ManaSymbols cost={card.manaCost} size="sm" className="mt-0.5 shrink-0" />
        )}
      </div>

      <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="truncate">{typeLine}</span>
        {card.power && card.toughness && (
          <span className="ml-auto shrink-0 font-mono tabular-nums">
            {card.power}/{card.toughness}
          </span>
        )}
      </div>

      {card.text && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border/40 bg-muted/20 p-2.5">
          <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            {card.text.split("\n").map((line, index) => (
              <p key={`${index}-${line}`}>
                <DynamicTextRender text={line} />
              </p>
            ))}
          </div>
        </div>
      )}

      {children}
    </div>
  );
}
