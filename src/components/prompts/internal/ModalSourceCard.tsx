import type { ReactNode } from "react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import type { DeckCard } from "@/protocol/deck";
import type { PromptPresentation as PromptPresentationInput } from "@/protocol";

export function useModalSourceCard(
  presentation: PromptPresentationInput,
  sourceCard?: DeckCard,
): {
  preview: ReactNode;
  presentation: PromptPresentationInput;
  inlineSourceCard?: DeckCard;
} {
  const minimal = useIsMobileGame();

  if (minimal) {
    return { preview: null, presentation, inlineSourceCard: sourceCard };
  }

  return {
    preview: sourceCard ? (
      <div className="pointer-events-none absolute top-0 left-full ml-6 drop-shadow-2xl">
        <ScryfallImg
          src={sourceCard.uris?.border_crop ?? sourceCard.uris?.normal}
          alt={sourceCard.identity.name}
          className="w-[240px] rounded-xl"
        />
      </div>
    ) : null,
    presentation,
    inlineSourceCard: undefined,
  };
}
