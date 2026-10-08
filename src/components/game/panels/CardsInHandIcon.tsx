import { ScryfallImg } from "@/components/ScryfallImg";
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { cn } from "@/lib/utils";

interface CardsInHandIconProps {
  count: number;
  className?: string;
}

export function CardsInHandIcon({ count, className }: CardsInHandIconProps) {
  const visibleCards = Math.min(3, Math.max(0, count));

  return (
    <span aria-hidden="true" className={cn("relative block shrink-0", className)}>
      {Array.from({ length: visibleCards }, (_, index) => (
        <ScryfallImg
          key={index}
          src={CARD_BACK_IMAGE_URL}
          alt=""
          loading="eager"
          className="pointer-events-none absolute bottom-0 h-[92%] w-1/2 select-none rounded-[9%] border border-border/60 object-cover shadow-sm"
          style={{
            left: `${12.5 + index * 15.625}%`,
            transform: `rotate(${(index - (visibleCards - 1) / 2) * 10}deg)`,
            transformOrigin: "50% 100%",
          }}
        />
      ))}
    </span>
  );
}
