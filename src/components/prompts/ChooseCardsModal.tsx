import { useState } from "react";

import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/game/Card";
import { CHOOSE_CARD_TILE_SIZE } from "@/components/game/game.styles";
import { useCardPreview } from "@/hooks/useCardPreview";
import { useLongPressPreview } from "@/hooks/useLongPressPreview";
import { HoverCardPreview } from "@/components/game/HoverCardPreview";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import { cn } from "@/lib/utils";
import { PromptPresentation } from "./internal/PromptPresentation";
import { useModalSourceCard } from "./internal/ModalSourceCard";
import type { CardDto } from "@/protocol/game";
import type { ChooseCardsInput } from "@/protocol";

function SelectableCard({
  card,
  selected,
  disabled,
  onClick,
}: {
  card: CardDto;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      data-card-id={card.id}
      onClick={disabled ? undefined : onClick}
      className={cn(
        CHOOSE_CARD_TILE_SIZE,
        "shrink-0 rounded transition-all",
        disabled ? "cursor-not-allowed opacity-30" : "cursor-pointer",
        selected && "ring-2 ring-primary",
      )}
    >
      <Card card={card} className="w-full" />
    </div>
  );
}

interface ChooseCardsModalProps {
  cards: ChooseCardsInput["cards"];
  presentation: ChooseCardsInput["presentation"];
  min: number;
  max: number;
  /** Reveal mode: cards are display-only and the footer is a single acknowledge button. */
  reveal?: boolean;
  onConfirm: (chosenCardIds: string[]) => void;
}

export function ChooseCardsModal({
  cards: rawCards,
  presentation,
  min,
  max,
  reveal = false,
  onConfirm,
}: ChooseCardsModalProps) {
  const cards = rawCards as CardDto[];
  const { preview: sourcePreview, presentation: display } = useModalSourceCard(presentation);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const chosen = [...selected];
  const canConfirm = chosen.length >= min && chosen.length <= max;
  const atMax = selected.size >= max;

  const acknowledge = () => onConfirm([]);
  useModalKeyboard({ onEnter: reveal ? acknowledge : undefined }, [reveal]);

  const preview = useCardPreview();
  const longPress = useLongPressPreview<CardDto>({
    resolve: (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-card-id]");
      const card = el && cards.find((c) => c.id === el.dataset.cardId);
      return card ? { item: card, anchor: el } : null;
    },
    show: (card, rect) =>
      preview.handleMouseEnter(card, undefined, { useAnchor: true, anchorOverride: rect }),
    hide: preview.dismiss,
  });

  return (
    <Modal maxWidth="max-w-3xl" maxHeight="">
      {sourcePreview}
      <div className="p-5">
        <PromptPresentation presentation={display} forceHorizontal />
      </div>

      <div
        className={cn(
          "mb-4 flex gap-2 sm:gap-3 px-3 sm:px-5 pt-2 pb-4",
          cards.length > 9
            ? "max-h-[60dvh] flex-wrap justify-center overflow-y-auto"
            : "always-scrollbar scrollbar-inset-x flex-nowrap overflow-x-auto",
        )}
        {...longPress}
      >
        {cards.map((c) =>
          reveal ? (
            <div key={c.id} data-card-id={c.id} className={cn(CHOOSE_CARD_TILE_SIZE, "shrink-0")}>
              <Card card={c} className="w-full" />
            </div>
          ) : (
            <SelectableCard
              key={c.id}
              card={c}
              selected={selected.has(c.id)}
              disabled={atMax && !selected.has(c.id)}
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.id)) next.delete(c.id);
                  else next.add(c.id);
                  return next;
                })
              }
            />
          ),
        )}
      </div>

      <Modal.Footer className="justify-end gap-3">
        {reveal ? (
          <Button size="sm" onClick={acknowledge}>
            Continue
          </Button>
        ) : (
          <>
            <span className="text-sm tabular-nums text-muted-foreground">
              {chosen.length}/{max}
            </span>
            <Button size="sm" disabled={!canConfirm} onClick={() => onConfirm(chosen)}>
              {chosen.length === 0 && min === 0 ? "Skip" : "Confirm"}
            </Button>
          </>
        )}
      </Modal.Footer>
      <HoverCardPreview preview={preview} />
    </Modal>
  );
}
