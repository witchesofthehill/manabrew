import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface EliminatedModalProps {
  heading: string;
  hosting: boolean;
  onObserve: () => void;
  onLeave: () => void;
}
export function EliminatedModal({ heading, hosting, onObserve, onLeave }: EliminatedModalProps) {
  return (
    <Modal maxWidth="max-w-md" onClose={onObserve}>
      <Modal.Header>
        <h2 className="text-base font-semibold">{heading}</h2>
      </Modal.Header>
      <Modal.Body className="text-sm">
        <p>
          {hosting
            ? i18n._(
                msg`Your seat is out, but this app still hosts the table. Stay connected so the other players can finish. You can leave through the game menu, which will warn you before ending their game.`,
              )
            : i18n._(
                msg`Your seat is out. Keep watching the table, or explicitly leave when you are ready.`,
              )}
        </p>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Close data-autofocus variant="primary" onClose={onObserve}>
          <Trans>Keep observing</Trans>
        </Modal.Close>
        {!hosting && (
          <Button variant="outline" onClick={onLeave}>
            <Trans>Leave game</Trans>
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
}
