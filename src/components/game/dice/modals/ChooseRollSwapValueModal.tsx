import { Modal } from "@/components/game/modals/Modal";
import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { MODAL_CARD_THUMBNAIL } from "@/components/game/game.styles";
import type { DeckCard } from "@/types/manabrew";

interface ChooseRollSwapValueModalProps {
  currentResult: number;
  power: number;
  toughness: number;
  sourceCard?: DeckCard;
  onConfirm: (choice: "power" | "toughness" | null) => void;
}

/**
 * Binary picker for the rolled-value / P or T exchange. Two big buttons,
 * each labelled with its current stat for context.
 */
export function ChooseRollSwapValueModal({
  currentResult,
  power,
  toughness,
  sourceCard,
  onConfirm,
}: ChooseRollSwapValueModalProps) {
  return (
    <Modal maxWidth="max-w-sm" maxHeight="">
      <div role="dialog" aria-modal="true" aria-labelledby="choose-roll-swap-value-title">
        <Modal.Header>
          <div className="flex items-center gap-3">
            {sourceCard && (
              <CardImageThumbnail card={sourceCard} className={MODAL_CARD_THUMBNAIL} />
            )}
            <div>
              <h2 id="choose-roll-swap-value-title" className="font-semibold text-base">
                Exchange roll {currentResult}
              </h2>
              <p className="text-xs text-muted-foreground font-medium">{sourceCard?.name}</p>
            </div>
          </div>
        </Modal.Header>

        <Modal.Instructions>Replace which stat with the rolled value?</Modal.Instructions>

        <div className="p-4 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => onConfirm("power")}>
            <span className="flex flex-col items-center">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Power</span>
              <span className="text-xl font-bold">{power}</span>
            </span>
          </Button>
          <Button variant="outline" size="lg" onClick={() => onConfirm("toughness")}>
            <span className="flex flex-col items-center">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Toughness
              </span>
              <span className="text-xl font-bold">{toughness}</span>
            </span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
