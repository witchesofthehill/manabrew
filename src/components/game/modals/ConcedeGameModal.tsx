import { useRef, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface ConcedeGameModalProps {
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  hosting?: boolean;
}
export function ConcedeGameModal({ onConfirm, onCancel, hosting = false }: ConcedeGameModalProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const confirm = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  return (
    <Modal maxWidth="max-w-md" onClose={pending ? undefined : onCancel}>
      <Modal.Header>
        <h2 className="text-base font-semibold">
          <Trans>Concede the game?</Trans>
        </h2>
      </Modal.Header>
      <Modal.Body className="space-y-3 text-sm">
        <p>
          <Trans>You forfeit the game. This cannot be undone.</Trans>
        </p>
        {hosting && (
          <p className="text-muted-foreground">
            <Trans>
              This app hosts the table. After conceding, stay connected so the remaining players can
              finish. Leaving later will end their game.
            </Trans>
          </p>
        )}
        {error && (
          <p role="alert" className="rounded-lg border border-destructive p-3 text-destructive">
            <Trans>Concession could not be delivered: {error}. You can retry or cancel.</Trans>
          </p>
        )}
        {pending && (
          <p role="status" className="text-muted-foreground">
            <Trans>Sending concession…</Trans>
          </p>
        )}
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Modal.Close data-autofocus variant="ghost" disabled={pending} onClose={onCancel}>
          <Trans>Cancel</Trans>
        </Modal.Close>
        <Button variant="destructive" disabled={pending} onClick={() => void confirm()}>
          {pending ? i18n._(msg`Conceding…`) : i18n._(msg`Concede`)}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
