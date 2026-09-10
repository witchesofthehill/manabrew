import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { Trans } from "@lingui/react/macro";
interface ConcedeGameModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}
export function ConcedeGameModal({ onConfirm, onCancel }: ConcedeGameModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onCancel}>
      <Modal.Header>
        <h2 className="font-semibold text-base">
          <Trans>Concede the game?</Trans>
        </h2>
      </Modal.Header>
      <Modal.Instructions>
        <Trans>You forfeit the game. This cannot be undone.</Trans>
      </Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button variant="destructive" onClick={onConfirm}>
          <Trans>Concede</Trans>
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
