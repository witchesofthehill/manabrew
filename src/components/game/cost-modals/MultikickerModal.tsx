import { useState } from "react";
import { Modal } from "../modals/Modal";
import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MODAL_CARD_IMAGE } from "../game.styles";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { DeckCard } from "@/types/manabrew";

interface MultikickerModalProps {
  cost: string;
  maxKicks: number;
  sourceCard?: DeckCard;
  onDecide: (kickCount: number) => void;
}

export function MultikickerModal({ cost, maxKicks, sourceCard, onDecide }: MultikickerModalProps) {
  const [count, setCount] = useState(0);

  useModalKeyboard({ onSpace: count > 0 ? () => onDecide(count) : undefined }, [count, onDecide]);

  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <Modal.Header>
        <h2 className="font-semibold text-base">Multikicker</h2>
      </Modal.Header>
      <div className="px-4 py-4 flex gap-3">
        {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_IMAGE} />}
        <div className="self-center flex-1">
          <p className="text-sm text-muted-foreground mb-3">
            Pay <ManaSymbols cost={cost} size="lg" /> per kick (max {maxKicks})
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={count <= 0}
              onClick={() => setCount((c) => Math.max(0, c - 1))}
            >
              -
            </Button>
            <span className="text-xl font-bold w-8 text-center">{count}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={count >= maxKicks}
              onClick={() => setCount((c) => Math.min(maxKicks, c + 1))}
            >
              +
            </Button>
          </div>
        </div>
      </div>
      <Modal.Footer>
        <Button variant="outline" onClick={() => onDecide(0)}>
          Skip
        </Button>
        <Button onClick={() => onDecide(count)}>Confirm ({count}x)</Button>
      </Modal.Footer>
    </Modal>
  );
}
