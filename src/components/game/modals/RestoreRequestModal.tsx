import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import type { CheckpointDto, RestoreVoteDto } from "@/protocol/game";
import { checkpointLabel } from "../game.utils";
interface RestoreRequestModalProps {
  checkpoint: CheckpointDto;
  localPlayerId: string;
  multiplayer: boolean;
  restoreVote: RestoreVoteDto | null;
  resolvePlayerName: (playerId: string) => string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}
export function RestoreRequestModal({
  checkpoint,
  localPlayerId,
  multiplayer,
  restoreVote,
  resolvePlayerName,
  onConfirm,
  onClose,
}: RestoreRequestModalProps) {
  const [sentAfterVoteId, setSentAfterVoteId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sent = sentAfterVoteId !== null;
  const target = checkpointLabel(checkpoint);
  const vote = sent && restoreVote && restoreVote.voteId > sentAfterVoteId ? restoreVote : null;
  const ownVote = vote?.requestedByPlayerId === localPlayerId;
  const status = ownVote ? vote.status : null;
  const outcome = !vote
    ? null
    : !ownVote
      ? `${resolvePlayerName(vote.requestedByPlayerId)} asked for a restore first. Your request was not sent to a vote.`
      : status?.type === "declined"
        ? `${resolvePlayerName(status.playerId)} declined.`
        : status?.type === "unavailable"
          ? `The snapshot for ${target} is no longer available.`
          : null;
  const awaiting = ownVote ? vote.awaitingPlayerIds.map(resolvePlayerName) : [];
  const waiting =
    awaiting.length > 0
      ? `Waiting for ${awaiting.join(", ")}…`
      : multiplayer && !ownVote
        ? `Waiting for the other players…`
        : `Restoring…`;
  useEffect(() => {
    if (status?.type === "approved") onClose();
  }, [status?.type, onClose]);
  const confirm = async () => {
    setError(null);
    const voteIdBeforeRequest = restoreVote?.voteId ?? 0;
    try {
      await onConfirm();
      setSentAfterVoteId(voteIdBeforeRequest);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <Modal maxWidth="max-w-md" onClose={onClose}>
      <Modal.Header>
        <h2 className="text-base font-semibold">Restore the game?</h2>
      </Modal.Header>
      <Modal.Body className="space-y-3 text-sm">
        {outcome ? (
          <p role="status">{outcome}</p>
        ) : sent ? (
          <p role="status" className="text-muted-foreground">
            {waiting}
          </p>
        ) : (
          <p>
            {multiplayer
              ? `This will ask the other players to go back to ${target}. Are you sure?`
              : `This will take the game back to ${target}. Are you sure?`}
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            The request could not be sent: {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="ghost" onClose={onClose}>
          {outcome ? `Close` : sent ? `Hide` : `Cancel`}
        </Modal.Close>
        {!sent && (
          <Button variant="primary" onClick={() => void confirm()}>
            Restore
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
