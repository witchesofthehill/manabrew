import { Loader2 } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

interface ConcedeGameModalProps {
  /** The directive is on the wire; waiting for the state to flip the seat. */
  conceding: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConcedeGameModal({ conceding, onConfirm, onCancel }: ConcedeGameModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={conceding ? undefined : onCancel}>
      <Modal.Header>
        <h2 className="font-semibold text-base">Concede the game?</h2>
      </Modal.Header>
      {conceding ? (
        <Modal.Instructions>
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Conceding…
          </span>
        </Modal.Instructions>
      ) : (
        <>
          <Modal.Instructions>You forfeit the game. This cannot be undone.</Modal.Instructions>
          <Modal.Footer>
            <Button variant="destructive" onClick={onConfirm}>
              Concede
            </Button>
            <Button onClick={onCancel}>Cancel</Button>
          </Modal.Footer>
        </>
      )}
    </Modal>
  );
}
