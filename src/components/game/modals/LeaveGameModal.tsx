import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

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
        <h2 className="font-semibold text-base">End the game for everyone?</h2>
      </Modal.Header>
      <Modal.Instructions>
        This app is hosting the game engine. Leaving shuts it down and ends the game for every
        player still in it.
      </Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onStay}>
          Stay
        </Button>
        <Button variant="destructive" onClick={onLeave}>
          Leave and end game
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
