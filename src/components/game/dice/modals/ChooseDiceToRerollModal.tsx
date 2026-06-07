import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/game/modals/Modal";
import { useTheme } from "@/hooks/useTheme";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import { DieFaceStatic } from "../DieFaceStatic";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { DeckCard } from "@/types/manabrew";

interface ChooseDiceToRerollModalProps {
  rolls: number[];
  sides?: number;
  sourceCard?: DeckCard;
  onConfirm: (rolls: number[]) => void;
}

interface SelectableDie {
  /** Stable index inside the rolls array — handles duplicate values. */
  index: number;
  value: number;
}

/**
 * Multi-select dice picker. Toggle dice on/off, then confirm. Confirming
 * with no selection is allowed (means "reroll nothing").
 */
export function ChooseDiceToRerollModal({
  rolls,
  sides = 6,
  sourceCard,
  onConfirm,
}: ChooseDiceToRerollModalProps) {
  const accentColor = useTheme().gameTheme.playerColors.self;
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const dice: SelectableDie[] = rolls.map((value, index) => ({ index, value }));

  const toggle = (index: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const handleConfirm = () => {
    const chosen = dice.filter((d) => selected.has(d.index)).map((d) => d.value);
    onConfirm(chosen);
  };
  useModalKeyboard({ onSpace: selected.size > 0 ? handleConfirm : undefined }, [
    selected,
    handleConfirm,
  ]);

  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <div role="dialog" aria-modal="true" aria-labelledby="choose-dice-reroll-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="choose-dice-reroll-title" className="font-semibold text-base">
                Choose dice to reroll
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
            </div>
          </div>
        </Modal.Header>

        <Modal.Instructions>Toggle dice to mark them for reroll, then confirm.</Modal.Instructions>

        <div className="p-4 flex flex-wrap gap-3 justify-center" role="group">
          {dice.map((die) => (
            <DieFaceStatic
              key={die.index}
              sides={sides}
              value={die.value}
              size="lg"
              accentColor={accentColor}
              selected={selected.has(die.index)}
              onClick={() => toggle(die.index)}
              ariaLabel={`Toggle die ${die.value}`}
            />
          ))}
        </div>

        <Modal.Footer>
          <Button variant="outline" size="sm" onClick={() => onConfirm([])}>
            Skip
          </Button>
          <Button size="sm" className="ml-2" onClick={handleConfirm}>
            Confirm
          </Button>
        </Modal.Footer>
      </div>
    </Modal>
  );
}
