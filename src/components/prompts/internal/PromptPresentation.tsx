import type { ReactNode } from "react";

import { ScryfallImg } from "@/components/ScryfallImg";
import { TextWithMana } from "@/components/game/TextWithMana";
import { useResolveDeckCard } from "./usePromptSourceCard";
import type { PromptPresentation as PromptPresentationInput } from "@/protocol";

export function PromptPresentation({
  presentation,
  actions,
}: {
  presentation: PromptPresentationInput;
  actions?: ReactNode;
}) {
  const { title, description, text, sourceCardId } = presentation;
  const sourceCard = useResolveDeckCard(sourceCardId ?? undefined);

  return (
    <div className="flex gap-5 items-stretch">
      {sourceCard && (
        <ScryfallImg
          src={sourceCard.uris.normal}
          alt={sourceCard.name}
          className="w-[220px] h-auto rounded-xl shadow-lg shrink-0"
        />
      )}
      <div className="flex flex-1 flex-col gap-3 min-w-0">
        <h2 className="font-semibold text-2xl leading-tight">
          <TextWithMana text={title} manaSize="lg" />
        </h2>
        {description && (
          <p className="text-base text-foreground/90 leading-relaxed">
            <TextWithMana text={description} manaSize="md" />
          </p>
        )}
        {text && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            <TextWithMana text={text} />
          </p>
        )}
        {actions && <div className="mt-auto flex justify-end gap-2">{actions}</div>}
      </div>
    </div>
  );
}
