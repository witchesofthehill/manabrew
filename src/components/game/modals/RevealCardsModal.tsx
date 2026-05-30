import { Button } from "@/components/ui/button";
import { Modal } from "./Modal";
import { Card } from "@/components/game/Card";
import type { GameCard } from "@/types/manabrew";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";

interface RevealCardsModalProps {
  cards: GameCard[];
  message: string;
  onConfirm: () => void;
}

export function RevealCardsModal({ cards, message, onConfirm }: RevealCardsModalProps) {
  useModalKeyboard({ onSpace: onConfirm }, [onConfirm]);
  return (
    <Modal maxWidth="max-w-4xl" maxHeight="max-h-[85vh]">
      <Modal.Header>
        <h2 className="font-semibold text-base">Look At Cards</h2>
        <p className="text-xs text-muted-foreground">{message}</p>
      </Modal.Header>

      <div className="px-4 pb-4 flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap gap-3 justify-center content-start">
          {cards.map((card) => (
            <div key={card.id} className="shrink-0">
              <Card card={card} />
            </div>
          ))}
        </div>
      </div>

      <Modal.Footer>
        <Button size="sm" onClick={onConfirm}>
          Continue
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
