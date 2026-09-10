import { Copy, Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AccountDeckDetail } from "@/api/hubTypes";
import { Trans } from "@lingui/react/macro";
interface DeckSaveConflictDialogProps {
  conflict: AccountDeckDetail | null;
  busy: boolean;
  onKeepMine: () => void;
  onUseAccount: () => void;
  onSaveCopy: () => void;
  onCancel: () => void;
}
export function DeckSaveConflictDialog({
  conflict,
  busy,
  onKeepMine,
  onUseAccount,
  onSaveCopy,
  onCancel,
}: DeckSaveConflictDialogProps) {
  return (
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>This deck changed on another device</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Your edits are saved locally. Choose which account version should be kept.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {conflict && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Trans>
              Account version {conflict.currentVersionNo} · updated{" "}
              {new Date(conflict.updatedAt).toLocaleString()}
            </Trans>
          </div>
        )}
        <div className="grid gap-2">
          <Button
            className="h-auto justify-start gap-3 py-3 text-left"
            disabled={busy}
            onClick={onKeepMine}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span>
              <span className="block font-semibold">
                <Trans>Keep my changes</Trans>
              </span>
              <span className="block text-xs font-normal opacity-80">
                <Trans>Save this device’s deck as the next account version.</Trans>
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto justify-start gap-3 py-3 text-left"
            disabled={busy}
            onClick={onUseAccount}
          >
            <Download className="h-4 w-4 shrink-0" />
            <span>
              <span className="block font-semibold">
                <Trans>Use the account version</Trans>
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                <Trans>Replace this device’s working deck with the latest account copy.</Trans>
              </span>
            </span>
          </Button>
          <Button
            variant="outline"
            className="h-auto justify-start gap-3 py-3 text-left"
            disabled={busy}
            onClick={onSaveCopy}
          >
            <Copy className="h-4 w-4 shrink-0" />
            <span>
              <span className="block font-semibold">
                <Trans>Save mine as a copy</Trans>
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                <Trans>Keep both decks without overwriting either version.</Trans>
              </span>
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
