import { useState } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { DynamicTextRender } from "@/components/game/DynamicTextRender";
import type { RepeatVoteDto } from "@/protocol";
interface RepeatVoteModalProps {
  repeatVote: RepeatVoteDto;
  resolvePlayerName: (playerId: string) => string;
  onVote: (accept: boolean) => Promise<void>;
}
export function RepeatVoteModal({ repeatVote, resolvePlayerName, onVote }: RepeatVoteModalProps) {
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
        <h2 className="text-base font-semibold">Repeat these actions?</h2>
      </Modal.Header>
      <Modal.Body className="space-y-3 text-sm">
        <p>
          {`${resolvePlayerName(repeatVote.requestedByPlayerId)} asks to repeat these actions ${repeatVote.iterations} times:`}
        </p>
        <ol className="list-decimal space-y-1 pl-5">
          {repeatVote.actions.map((action, index) => (
            <li key={index}>
              <DynamicTextRender className="align-middle" text={action} />
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground">You pass priority each time it comes to you.</p>
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
