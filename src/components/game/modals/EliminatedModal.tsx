import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

interface EliminatedModalProps {
  heading: string;
  /** Engine owner: leaving would end the game for everyone, so the modal
   *  offers no exit — the Leave menu action (with its warning) still exists. */
  hosting: boolean;
  onObserve: () => void;
  onLeave: () => void;
}

/** Shown when the local seat goes out of the game — conceded or knocked out.
 *  The player stays connected: observing is the default, leaving is explicit. */
export function EliminatedModal({ heading, hosting, onObserve, onLeave }: EliminatedModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onObserve}>
      <Modal.Header>
        <h2 className="font-semibold text-base">{heading}</h2>
      </Modal.Header>
      <Modal.Instructions>
        {hosting
          ? "Your seat is out of the game, but you can't exit quite yet — this app is hosting " +
            "the game engine, so leaving would end the game for everyone still playing."
          : "Your seat is out of the game. You can keep watching the table, or leave the game for good."}
      </Modal.Instructions>
      <Modal.Footer>
        {!hosting && (
          <Button variant="outline" onClick={onLeave}>
            Leave game
          </Button>
        )}
        <Button onClick={onObserve}>Keep observing</Button>
      </Modal.Footer>
    </Modal>
  );
}
