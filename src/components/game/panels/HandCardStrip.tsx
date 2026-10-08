import { ScryfallImg } from "@/components/ScryfallImg";
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { cn } from "@/lib/utils";
import type { CardDto } from "@/protocol/game";

const THUMB_CLASS =
  "pointer-events-none aspect-[5/7] h-16 shrink-0 select-none rounded-[6%] border border-border/60 object-cover shadow-sm [&:not(:first-child)]:-ml-5";

interface HandCardStripProps {
  cards: CardDto[];
  count: number;
}

export function HandCardStrip({ cards, count }: HandCardStripProps) {
  return (
    <span aria-hidden="true" className="flex min-w-0 overflow-hidden">
      {cards.map((card) => (
        <HandCardThumb key={card.id} card={card} />
      ))}
      {Array.from({ length: Math.max(0, count - cards.length) }, (_, index) => (
        <ScryfallImg
          key={index}
          src={CARD_BACK_IMAGE_URL}
          alt=""
          loading="eager"
          className={THUMB_CLASS}
        />
      ))}
    </span>
  );
}

function HandCardThumb({ card }: { card: CardDto }) {
  const url = useResolvedGameCard(card).imageUrl(card.isTransformed ? 1 : 0, "small");
  if (!url) return <span className={cn(THUMB_CLASS, "bg-muted")} />;
  return <ScryfallImg src={url} alt="" loading="eager" className={THUMB_CLASS} />;
}
