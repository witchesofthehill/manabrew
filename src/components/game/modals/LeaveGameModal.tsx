import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

/** Who is leaving decides what leaving costs. */
export type LeaveGameMode = "engineOwner" | "seat" | "solo";

interface LeaveGameModalProps {
  /** `engineOwner` (default): this app carries the engine, so leaving ends the
   *  game for everyone. `seat`: a guest seat at someone else's table. `solo`: a
   *  local game with nobody else in it. */
  mode?: LeaveGameMode;
  onStay: () => void;
  onLeave: () => void;
}

const COPY: Record<LeaveGameMode, { heading: string; body: string; leave: string }> = {
  engineOwner: {
    heading: "End the game for everyone?",
    body:
      "This app is hosting the game engine. Leaving shuts it down and ends the game for every " +
      "player still in it.",
    leave: "Leave and end game",
  },
  seat: {
    heading: "Leave the table?",
    body: "You give up your seat and the game goes on without you. There is no way back in.",
    leave: "Leave table",
  },
  solo: {
    heading: "Leave the game?",
    body: "The game ends here. There is nothing to come back to.",
    leave: "Leave game",
  },
};

export function LeaveGameModal({ mode = "engineOwner", onStay, onLeave }: LeaveGameModalProps) {
  const copy = COPY[mode];
  return (
    <Modal maxWidth="max-w-md" maxHeight="" onClose={onStay}>
      <Modal.Header>
        <h2 className="font-semibold text-base">{copy.heading}</h2>
      </Modal.Header>
      <Modal.Instructions>{copy.body}</Modal.Instructions>
      <Modal.Footer className="justify-between">
        <Button variant="outline" onClick={onStay}>
          Stay
        </Button>
        <Button variant="destructive" onClick={onLeave}>
          {copy.leave}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
