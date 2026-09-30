import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import type { RestoreVoteDto } from "@/protocol/game";
import { checkpointLabel } from "../game.utils";
interface RestoreVoteModalProps {
  restoreVote: RestoreVoteDto;
  resolvePlayerName: (playerId: string) => string;
  onVote: (accept: boolean) => Promise<void>;
}
export function RestoreVoteModal({
  restoreVote,
  resolvePlayerName,
  onVote,
}: RestoreVoteModalProps) {
  const [voted, setVoted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vote = async (accept: boolean) => {
    setError(null);
    setVoted(true);
    try {
      await onVote(accept);
    } catch (cause) {
      setVoted(false);
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Modal maxWidth="max-w-md">
      <Modal.Header>
        <h2 className="text-base font-semibold">Restore the game?</h2>
      </Modal.Header>
      <Modal.Body className="space-y-3 text-sm">
        <p>
          {`${resolvePlayerName(restoreVote.requestedByPlayerId)} asks to go back to ${checkpointLabel(restoreVote.checkpoint)}.`}
        </p>
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            Your vote could not be sent: {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Button variant="ghost" disabled={voted} onClick={() => void vote(false)}>
          No
        </Button>
        <Button variant="primary" disabled={voted} onClick={() => void vote(true)}>
          Yes
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
