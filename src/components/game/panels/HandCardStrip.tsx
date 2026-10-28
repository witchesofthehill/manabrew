import { CardFoilOverlay } from "@/components/game/CardFoilOverlay";
import { isEtchedOnlyPrinting } from "@/lib/cardFinish";
import { ScryfallImg } from "@/components/ScryfallImg";
import { CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { GeneratedCardImage } from "@/components/game/GeneratedCardImage";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useResolvedGameCard } from "@/hooks/useResolvedGameCard";
import { cn } from "@/lib/utils";
import type { CardDto } from "@/protocol/game";
import { gameCardFaceIndex } from "@/lib/gameCard";

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
  const resolved = useResolvedGameCard(card);
  const resolvedUrl = resolved.imageUrl(gameCardFaceIndex(card), "small");
  const hidden = card.isFaceDown || !card.identity.name;
  const url = hidden ? CARD_BACK_IMAGE_URL : resolvedUrl;
  const presentation = usePreferencesStore((state) => state.handCardStyle);
  if (presentation === "rules") {
    return (
      <GeneratedCardImage
        card={card}
        className={THUMB_CLASS}
        fallback={
          url ? (
            <ScryfallImg
              src={url}
              alt=""
              className="h-full w-full rounded-[inherit] object-contain"
            />
          ) : undefined
        }
      />
    );
  }
  if (!url) return <span className={cn(THUMB_CLASS, "bg-muted")} />;
  return (
    <span className={cn(THUMB_CLASS, "relative")}>
      <ScryfallImg
        src={url}
        alt=""
        loading="eager"
        className="h-full w-full rounded-[inherit] object-cover"
      />
      <CardFoilOverlay
        enabled={!hidden}
        foil={!hidden && !!card.foil}
        cosmetics={hidden ? undefined : card.cosmetics}
        etched={!hidden && isEtchedOnlyPrinting(resolved.info?.finishes)}
      />
    </span>
  );
}
