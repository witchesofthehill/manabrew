import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

interface EliminatedModalProps {
  heading: string;
  hosting: boolean;
  onObserve: () => void;
  onLeave: () => void;
}
export function EliminatedModal({ heading, hosting, onObserve, onLeave }: EliminatedModalProps) {
  return (
    <Modal maxWidth="max-w-md" onClose={onObserve}>
      <Modal.Header>
        <h2 className="text-base font-semibold">{heading}</h2>
      </Modal.Header>
      <Modal.Body className="text-sm">
        <p>
          {hosting
            ? "Your seat is out, but this app still hosts the table. Stay connected so the other players can finish. You can leave through the game menu, which will warn you before ending their game."
            : "Your seat is out. Keep watching the table, or explicitly leave when you are ready."}
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close data-autofocus onClose={onObserve}>
          Keep observing
        </Modal.Close>
        {!hosting && (
          <Button variant="outline" onClick={onLeave}>
            Leave game
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
