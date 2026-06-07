import { Modal } from "@/components/game/modals/Modal";
import { useTheme } from "@/hooks/useTheme";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import { DieFaceStatic } from "../DieFaceStatic";
import type { DeckCard } from "@/types/manabrew";

interface ChooseRollToModifyModalProps {
  rolls: number[];
  sides?: number;
  sourceCard?: DeckCard;
  onConfirm: (roll: number | null) => void;
}

/**
 * Pick one die to increment / decrement by 1. The +/- decision is
 * delivered as a separate `IncreaseOrDecrease` binary prompt by the engine.
 */
export function ChooseRollToModifyModal({
  rolls,
  sides = 6,
  sourceCard,
  onConfirm,
}: ChooseRollToModifyModalProps) {
  const accentColor = useTheme().gameTheme.playerColors.self;

  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <div role="dialog" aria-modal="true" aria-labelledby="choose-roll-modify-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="choose-roll-modify-title" className="font-semibold text-base">
                Choose a roll to modify
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
            </div>
          </div>
        </Modal.Header>

        <Modal.Instructions>Click a die to apply a +1 / -1 modifier.</Modal.Instructions>

        <div className="p-4 flex flex-wrap gap-3 justify-center" role="group">
          {rolls.map((value, index) => (
            <DieFaceStatic
              key={`${value}-${index}`}
              sides={sides}
              value={value}
              size="lg"
              accentColor={accentColor}
              onClick={() => onConfirm(value)}
              ariaLabel={`Modify die ${value}`}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}
