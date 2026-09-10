import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { Trans } from "@lingui/react/macro";
interface LeaveGameModalProps {
  onStay: () => void;
  onLeave: () => void;
}
/** Engine-owner leave warning: this app carries the game engine, so leaving
 *  ends the game for every player still in it. */
export function LeaveGameModal({ onStay, onLeave }: LeaveGameModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onStay}>
      <Modal.Header>
        <h2 className="font-semibold text-base">
          <Trans>End the game for everyone?</Trans>
        </h2>
      </Modal.Header>
      <Modal.Instructions>
        <Trans>
          This app is hosting the game engine. Leaving shuts it down and ends the game for every
          player still in it.
        </Trans>
      </Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onStay}>
          <Trans>Stay</Trans>
        </Button>
        <Button variant="destructive" onClick={onLeave}>
          <Trans>Leave and end game</Trans>
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
