import type { ReactNode } from "react";

import { Card } from "@/components/game/Card";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { useSourceCardDto } from "./usePromptSourceCard";
import type { PromptPresentation as PromptPresentationInput } from "@/protocol";

export function useModalSourceCard(presentation: PromptPresentationInput): {
  preview: ReactNode;
  presentation: PromptPresentationInput;
} {
  const minimal = useIsMobileGame();
  const sourceCard = useSourceCardDto(presentation.sourceCardId);

  if (minimal) {
    return { preview: null, presentation };
  }

  return {
    preview: sourceCard ? (
      <div className="pointer-events-none absolute top-0 left-full ml-6 drop-shadow-2xl">
        <Card card={sourceCard} bare className="w-[240px]" />
      </div>
    ) : null,
    presentation: { ...presentation, sourceCardId: undefined },
  };
}
