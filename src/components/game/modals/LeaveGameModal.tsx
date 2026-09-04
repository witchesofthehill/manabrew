import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

interface LeaveGameModalProps {
  /** Whether conceding would end the game here, or only remove this seat from
   *  a game the others would carry on without an engine to run it. Omitted
   *  where there is no live game to concede, such as leaving a lobby. */
  endsWithConcede?: boolean;
  onStay: () => void;
  onConcede?: () => void;
  onLeave: () => void;
}

/** Engine-owner leave warning: this app carries the game engine, so it cannot
 *  leave a live game behind. When the table is down to one other player, that
 *  is a concession and the game ends with a winner like any other. Otherwise
 *  there is no result to reach and leaving takes the game with it. */
export function LeaveGameModal({
  endsWithConcede = false,
  onStay,
  onConcede,
  onLeave,
}: LeaveGameModalProps) {
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onStay}>
      <Modal.Header>
        <h2 className="font-semibold text-base">
          {endsWithConcede ? "Concede the game?" : "End the game for everyone?"}
        </h2>
      </Modal.Header>
      <Modal.Instructions>
        {endsWithConcede
          ? "This app is hosting the game engine, so it has to stay until the game ends. Conceding ends it now: your opponent wins and everyone sees the result."
          : "This app is hosting the game engine. Leaving shuts it down and ends the game for every player still in it, with no result for anyone."}
      </Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onStay}>
          Stay
        </Button>
        <Button variant="destructive" onClick={endsWithConcede && onConcede ? onConcede : onLeave}>
          {endsWithConcede ? "Concede" : "Leave and end game"}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
