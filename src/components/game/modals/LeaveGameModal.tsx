import { useRef, useState } from "react";
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
  onLeave: () => void | Promise<void>;
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const leave = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onLeave();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <Modal maxWidth="max-w-md" onClose={pending ? undefined : onStay}>
      <Modal.Header>
        <h2 className="font-semibold text-base">{copy.heading}</h2>
      </Modal.Header>
      <Modal.Instructions>{copy.body}</Modal.Instructions>
      {(pending || error) && (
        <Modal.Body className="space-y-3 text-sm">
          {pending && <p role="status">Leaving…</p>}
          {error && (
            <p role="alert" className="text-destructive">
              Could not leave: {error}
            </p>
          )}
        </Modal.Body>
      )}
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="outline" disabled={pending} onClose={onStay}>
          Stay
        </Modal.Close>
        <Button variant="destructive" disabled={pending} onClick={() => void leave()}>
          {copy.leave}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
