import { useState } from "react";
import { CardPreview } from "@/components/game/CardPreview";
import { FLASH_CARD_SIZE } from "@/components/game/game.styles";
import type { useCardPreview } from "@/hooks/useCardPreview";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface Props {
  preview: ReturnType<typeof useCardPreview>;
  className?: string;
}
export function LimitedHoverPreviewPane({ preview, className }: Props) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const card = preview.hoveredCard;
  const supportsFlip = !!card?.isDoubleFaced;
  return (
    <div
      style={{ width: FLASH_CARD_SIZE.w, height: FLASH_CARD_SIZE.h }}
      className={`relative shrink-0 self-start rounded-md border border-border/40 bg-card/20 ${className ?? ""}`}
    >
      <div ref={setSlot} className="absolute inset-0 overflow-hidden rounded-md" />
      {card && slot ? (
        <CardPreview
          card={card}
          mouseX={0}
          mouseY={0}
          isSticky={preview.isSticky}
          showBackFace={preview.showBackFace}
          slot={slot}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
          <Trans>Hover a card to preview it here.</Trans>
        </div>
      )}
      {supportsFlip && (
        <button
          type="button"
          onClick={preview.flipCard}
          className="absolute bottom-2 right-2 z-10 rounded-full border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/90 hover:bg-black/80"
          aria-label={i18n._(msg`Flip card`)}
        >
          <Trans>Flip</Trans>
        </button>
      )}
    </div>
  );
}
