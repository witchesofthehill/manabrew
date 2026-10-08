import type { CardDto } from "@/protocol/game";
import { DialogCardInspector } from "@/components/game/modals/DialogCardInspector";
import { useCardInspection } from "@/components/game/modals/cardInspection";
import { Modal } from "@/components/game/modals/Modal";

interface CardInspectModalProps {
  card: CardDto;
  onClose: () => void;
}

export function CardInspectModal({ card, onClose }: CardInspectModalProps) {
  const inspection = useCardInspection();
  return (
    <Modal onClose={onClose} maxWidth="max-w-2xl">
      <Modal.Header onClose={onClose}>
        <h2 className="text-base font-semibold">{card.identity.name}</h2>
      </Modal.Header>
      <Modal.Body>
        <DialogCardInspector
          card={card}
          state={inspection.stateFor(card)}
          onChange={(state) => inspection.change(card.id, state)}
        />
      </Modal.Body>
    </Modal>
  );
}
