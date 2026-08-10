import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import { useModalKeyboard } from "@/hooks/useModalKeyboard";
import type { ActionConfirmRequest } from "@/components/prompts/internal/actionConfirm";

interface ConfirmActionModalProps {
  request: ActionConfirmRequest;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionModal({ request, onConfirm, onCancel }: ConfirmActionModalProps) {
  useModalKeyboard({ onEnter: onConfirm, onEscape: onCancel }, [onConfirm, onCancel]);

  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onCancel}>
      <Modal.Header>
        <h2 className="font-semibold text-base">{request.title}</h2>
      </Modal.Header>
      <Modal.Instructions>
        {request.lines.map((line) => (
          <DynamicTextRender key={line} className="block align-middle" text={line} />
        ))}
      </Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onConfirm}>{request.confirmLabel}</Button>
      </Modal.Footer>
    </Modal>
  );
}
