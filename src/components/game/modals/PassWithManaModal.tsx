import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { getManaPoolEntries } from "@/components/game/manaUtils";
import { Modal } from "./Modal";

export type PendingPassKind = "priority" | "endTurn";

interface PassWithManaModalProps {
  kind: PendingPassKind;
  manaPool: Record<string, number>;
  onConfirm: () => void;
  onCancel: () => void;
  onOpenSetting: () => void;
}

export function PassWithManaModal({
  kind,
  manaPool,
  onConfirm,
  onCancel,
  onOpenSetting,
}: PassWithManaModalProps) {
  const entries = getManaPoolEntries(manaPool);
  const endingTurn = kind === "endTurn";

  return (
    <Modal maxWidth="max-w-md" onClose={onCancel}>
      <Modal.Header onClose={onCancel}>
        <h2 className="text-base font-semibold">
          {endingTurn ? "End turn with unspent mana?" : "Pass with unspent mana?"}
        </h2>
      </Modal.Header>
      <Modal.Body className="space-y-3">
        <p className="text-ui-body text-muted-foreground">
          Unspent mana empties when the current step or phase ends.
        </p>
        <dl className="flex flex-wrap gap-2" aria-label="Floating mana">
          {entries.map(({ color, count }) => (
            <div
              key={color}
              className="flex items-center gap-2 rounded-md border bg-muted/25 px-2.5 py-1.5"
            >
              <dt className="flex items-center">
                <ManaSymbols cost={color} size="lg" className="mx-0" />
              </dt>
              <dd className="text-ui-label font-semibold tabular-nums lining-nums">{count}</dd>
            </div>
          ))}
        </dl>
      </Modal.Body>
      <Modal.Footer className="justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onOpenSetting}
          title="Open board settings to turn off this prompt"
        >
          <Settings className="h-4 w-4" />
          Turn off
        </Button>
        <div className="flex items-center gap-2">
          <Modal.Close data-autofocus variant="ghost" onClose={onCancel}>
            Cancel
          </Modal.Close>
          <Button variant="primary" onClick={onConfirm}>
            {endingTurn ? "End turn anyway" : "Pass anyway"}
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
