import { Bookmark, Gem, Sparkles } from "lucide-react";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { useDeckStore } from "@/stores/useDeckStore";
import { useIsComboCard, useIsGameChangerCard } from "@/stores/useDeckAnalysisStore";
import type { CardRulesSummary } from "@/types/manabrew";

export type PreviewCard = CardRulesSummary & { name: string };

export function PreviewCardInfo({ card }: { card: PreviewCard }) {
  const currentDeck = useDeckStore((s) => s.currentDeck);
  const isCombo = useIsComboCard(card.name);
  const isGameChanger = useIsGameChangerCard(card.name);

  const mainCopies =
    currentDeck.cards.filter((c) => c.name === card.name).length +
    (currentDeck.commanders?.filter((c) => c.name === card.name).length ?? 0);
  const sideCopies = currentDeck.sideboard.filter((c) => c.name === card.name).length;
  const tags = currentDeck.cardTags?.[card.name.toLowerCase()] ?? [];

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
        <span className="text-sm font-semibold leading-tight">{card.name}</span>
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
            {card.text.split("\n").map((line, i) => (
              <p key={i}>
                <DynamicTextRender text={line} />
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {mainCopies > 0 && (
          <span className="rounded-full border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            {mainCopies} in deck
          </span>
        )}
        {sideCopies > 0 && (
          <span className="rounded-full border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground">
            {sideCopies} sideboard
          </span>
        )}
        {isGameChanger && (
          <span className="flex items-center gap-1 rounded-full bg-pt-lethal/15 px-2 py-0.5 text-[10px] font-medium text-pt-lethal">
            <Gem className="h-3 w-3" /> Game Changer
          </span>
        )}
        {isCombo && (
          <span className="flex items-center gap-1 rounded-full bg-counter-charge/15 px-2 py-0.5 text-[10px] font-medium text-counter-charge">
            <Sparkles className="h-3 w-3" /> Combo piece
          </span>
        )}
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary"
          >
            <Bookmark className="h-3 w-3" /> {tag}
          </span>
        ))}
      </div>
    </div>
  );
}
