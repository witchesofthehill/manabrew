import { useState } from "react";
import { Modal } from "../modals/Modal";
import { Button } from "@/components/ui/button";
import { CardImageThumbnail } from "@/components/game/CardImageThumbnail";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { MODAL_CARD_IMAGE } from "../game.styles";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { DeckCard } from "@/types/manabrew";

interface ReplicateModalProps {
  cost: string;
  maxReplicates: number;
  sourceCard?: DeckCard;
  onDecide: (replicateCount: number) => void;
}

export function ReplicateModal({ cost, maxReplicates, sourceCard, onDecide }: ReplicateModalProps) {
  const [count, setCount] = useState(0);

  useModalKeyboard({ onSpace: count > 0 ? () => onDecide(count) : undefined }, [count, onDecide]);

  return (
    <Modal maxWidth="max-w-md" maxHeight="">
      <Modal.Header>
        <h2 className="font-semibold text-base">Replicate</h2>
      </Modal.Header>
      <div className="px-4 py-4 flex gap-3">
        {sourceCard && <CardImageThumbnail card={sourceCard} className={MODAL_CARD_IMAGE} />}
        <div className="self-center flex-1">
          <p className="text-sm text-muted-foreground mb-3">
            Pay <ManaSymbols cost={cost} size="lg" /> per copy (max {maxReplicates})
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
              disabled={count >= maxReplicates}
              onClick={() => setCount((c) => Math.min(maxReplicates, c + 1))}
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
