import { Bookmark, Gem, Sparkles } from "lucide-react";
import { CardPreviewDetails } from "@/components/game/CardPreviewDetails";
import type { PreviewCard } from "@/lib/cardPreview";
import { useDeckStore } from "@/stores/useDeckStore";
import { useIsComboCard, useIsGameChangerCard } from "@/stores/useDeckAnalysisStore";
import { CARD_ROLE_LABELS, useCardRoles } from "@/stores/useCardRolesStore";

export function PreviewCardInfo({ card }: { card: PreviewCard }) {
  const currentDeck = useDeckStore((s) => s.currentDeck);
  const { name } = card.identity;
  const isCombo = useIsComboCard(name);
  const isGameChanger = useIsGameChangerCard(name);
  const roles = useCardRoles(name);

  const mainCopies =
    currentDeck.cards.filter((c) => c.identity.name === name).length +
    (currentDeck.commanders?.filter((c) => c.identity.name === name).length ?? 0);
  const sideCopies = currentDeck.sideboard.filter((c) => c.identity.name === name).length;
  const tags = currentDeck.cardTags?.[name.toLowerCase()] ?? [];

  return (
    <CardPreviewDetails card={card}>
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
        {roles.map((role) => (
          <span
            key={role}
            className="rounded-full border bg-background/60 px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {CARD_ROLE_LABELS[role] ?? role}
          </span>
        ))}
      </div>
    </CardPreviewDetails>
  );
}
