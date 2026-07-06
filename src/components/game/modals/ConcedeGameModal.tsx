import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

interface ConcedeGameModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConcedeGameModal({ onConfirm, onCancel }: ConcedeGameModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onCancel}>
      <Modal.Header>
        <h2 className="font-semibold text-base">Concede the game?</h2>
      </Modal.Header>
      <Modal.Instructions>You forfeit the game. This cannot be undone.</Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          Concede
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
