import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

/** Who is leaving decides what leaving costs. */
export type LeaveGameMode = "engineOwner" | "seat" | "solo";

interface LeaveGameModalProps {
  /** `engineOwner` (default): this app carries the engine, so leaving ends the
   *  game for everyone. `seat`: a guest seat at someone else's table. `solo`: a
   *  local game with nobody else in it. */
  mode?: LeaveGameMode;
  /** Engine owner only. Whether conceding would end the game here, or only
   *  remove this seat from a game the others would carry on without an engine
   *  to run it. Omitted where there is no live game to concede, such as
   *  leaving a lobby. */
  endsWithConcede?: boolean;
  onStay: () => void;
  onConcede?: () => void;
  onLeave: () => void;
}

const COPY: Record<LeaveGameMode, { heading: string; body: string; leave: string }> = {
  engineOwner: {
    heading: "End the game for everyone?",
    body:
      "This app is hosting the game engine. Leaving shuts it down and ends the game for every " +
      "player still in it, with no result for anyone.",
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

/** The engine owner cannot leave a live game behind. When the table is down to
 *  one other player, that is a concession and the game ends with a winner like
 *  any other. Otherwise there is no result to reach and leaving takes the game
 *  with it. */
const CONCEDE_COPY = {
  heading: "Concede the game?",
  body:
    "This app is hosting the game engine, so it has to stay until the game ends. Conceding " +
    "ends it now: your opponent wins and everyone sees the result.",
  leave: "Concede",
};

export function LeaveGameModal({
  mode = "engineOwner",
  endsWithConcede = false,
  onStay,
  onConcede,
  onLeave,
}: LeaveGameModalProps) {
  const concedes = mode === "engineOwner" && endsWithConcede && onConcede !== undefined;
  const copy = concedes ? CONCEDE_COPY : COPY[mode];
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
        <Button variant="destructive" onClick={concedes ? onConcede : onLeave}>
          {copy.leave}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
