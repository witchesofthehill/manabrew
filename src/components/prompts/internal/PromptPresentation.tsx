import type { ReactNode } from "react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { useIsMobileGame } from "@/hooks/useBreakpoints";
import { PROMPT_SOURCE_CARD_SIZE } from "@/components/game/game.styles";
import { cn } from "@/lib/utils";
import { useResolveDeckCard } from "./usePromptSourceCard";
import { PromptTargets } from "./PromptTargets";
import { isVerticalPresentation } from "./promptLayout";
import type { PromptPresentation as PromptPresentationInput } from "@/protocol";

export function PromptPresentation({
  presentation,
  actions,
  forceHorizontal = false,
}: {
  presentation: PromptPresentationInput;
  actions?: ReactNode;
  forceHorizontal?: boolean;
}) {
  const { title, description, text, sourceCardId, targets } = presentation;
  const sourceCard = useResolveDeckCard(sourceCardId ?? undefined);
  const minimal = useIsMobileGame();

  const isVertical = !forceHorizontal && isVerticalPresentation(presentation);

  const body = (
    <>
      <h2
        className={cn("font-semibold", minimal ? "text-lg leading-snug" : "text-2xl leading-tight")}
      >
        <DynamicTextRender text={title} />
      </h2>
      {description && (
        <p className={cn("text-foreground/90 leading-relaxed", minimal ? "text-sm" : "text-base")}>
          <DynamicTextRender text={description} />
        </p>
      )}
      {text && (
        <p className={cn("text-muted-foreground leading-relaxed", minimal ? "text-xs" : "text-sm")}>
          <DynamicTextRender text={text} />
        </p>
      )}
    </>
  );

  if (isVertical && minimal) {
    return (
      <div className="mx-auto flex w-fit flex-col gap-2">
        <div className="flex flex-row items-start gap-3">
          {sourceCard && (
            <ScryfallImg
              src={sourceCard.uris.normal}
              alt={sourceCard.identity.name}
              className={cn(
                PROMPT_SOURCE_CARD_SIZE.verticalCompact,
                "h-auto object-contain rounded-xl shadow-lg shrink-0",
              )}
            />
          )}
          <div className="flex w-full flex-col gap-2 text-left">{body}</div>
        </div>
        {actions && <div className="mt-1 grid w-full grid-cols-2 gap-2">{actions}</div>}
      </div>
    );
  }

  if (isVertical) {
    return (
      <div className="mx-auto flex w-fit flex-col gap-4">
        {sourceCard && (
          <ScryfallImg
            src={sourceCard.uris.normal}
            alt={sourceCard.identity.name}
            className={cn(
              PROMPT_SOURCE_CARD_SIZE.vertical,
              "h-auto self-center object-contain rounded-xl shadow-lg",
            )}
          />
        )}
        <div className="flex w-full flex-col gap-2 text-left">{body}</div>
        {actions && <div className="mt-1 grid w-full grid-cols-2 gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className={cn("items-stretch flex", minimal ? "gap-3" : "gap-5")}>
      {sourceCard && (
        <ScryfallImg
          src={sourceCard.uris.normal}
          alt={sourceCard.identity.name}
          className={cn(
            "h-auto self-start object-contain rounded-xl shadow-lg shrink-0",
            minimal
              ? PROMPT_SOURCE_CARD_SIZE.horizontalCompact
              : PROMPT_SOURCE_CARD_SIZE.horizontal,
          )}
        />
      )}
      <div className={cn("flex flex-1 flex-col min-w-0", minimal ? "gap-2" : "gap-3")}>
        {body}
        <PromptTargets targets={targets} />
        {actions && <div className="mt-auto flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
