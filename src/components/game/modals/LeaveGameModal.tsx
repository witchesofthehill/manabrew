import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";

interface LeaveGameModalProps {
  onStay: () => void;
  onLeave: () => void | Promise<void>;
}
export function LeaveGameModal({ onStay, onLeave }: LeaveGameModalProps) {
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
        <h2 className="text-base font-semibold">End the game for everyone?</h2>
      </Modal.Header>
      <Modal.Body className="space-y-3 text-sm">
        <p>
          This app hosts the game engine. Leaving shuts it down and ends the game for every player
          still in it.
        </p>
        {pending && <p role="status">Leaving the hosted game…</p>}
        {error && (
          <p role="alert" className="text-destructive">
            Could not leave: {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="outline" disabled={pending} onClose={onStay}>
          Stay
        </Modal.Close>
        <Button variant="destructive" disabled={pending} onClick={() => void leave()}>
          Leave and end game
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
