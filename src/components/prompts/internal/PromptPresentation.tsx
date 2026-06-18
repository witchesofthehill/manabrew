import type { ReactNode } from "react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { useResolveDeckCard } from "./usePromptSourceCard";
import { PromptTargets } from "./PromptTargets";
import { isVerticalPresentation } from "./promptLayout";
import type { PromptPresentation as PromptPresentationInput } from "@/protocol";

export function PromptPresentation({
  presentation,
  actions,
}: {
  presentation: PromptPresentationInput;
  actions?: ReactNode;
}) {
  const { title, description, text, sourceCardId, targets } = presentation;
  const sourceCard = useResolveDeckCard(sourceCardId ?? undefined);

  const isVertical = isVerticalPresentation(presentation);

  const body = (
    <>
      <h2 className="font-semibold text-2xl leading-tight">
        <DynamicTextRender text={title} />
      </h2>
      {description && (
        <p className="text-base text-foreground/90 leading-relaxed">
          <DynamicTextRender text={description} />
        </p>
      )}
      {text && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          <DynamicTextRender text={text} />
        </p>
      )}
    </>
  );

  if (isVertical) {
    return (
      <div className="mx-auto flex w-fit flex-col gap-4">
        {sourceCard && (
          <ScryfallImg
            src={sourceCard.uris.normal}
            alt={sourceCard.name}
            className="w-[200px] h-auto self-center object-contain rounded-xl shadow-lg"
          />
        )}
        <div className="flex w-full flex-col gap-2 text-left">{body}</div>
        {actions && <div className="mt-1 grid w-full grid-cols-2 gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className="flex gap-5 items-stretch">
      {sourceCard && (
        <ScryfallImg
          src={sourceCard.uris.normal}
          alt={sourceCard.name}
          className="w-[220px] h-auto self-start object-contain rounded-xl shadow-lg shrink-0"
        />
      )}
      <div className="flex flex-1 flex-col gap-3 min-w-0">
        {body}
        <PromptTargets targets={targets} />
        {actions && <div className="mt-auto flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
