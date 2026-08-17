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
          <DialogTitle>This deck changed on another device</DialogTitle>
          <DialogDescription>
            Your edits are saved locally. Choose which account version should be kept.
          </DialogDescription>
        </DialogHeader>
        {conflict && (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Account version {conflict.currentVersionNo} · updated{" "}
            {new Date(conflict.updatedAt).toLocaleString()}
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
              <span className="block font-semibold">Keep my changes</span>
              <span className="block text-xs font-normal opacity-80">
                Save this device’s deck as the next account version.
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
              <span className="block font-semibold">Use the account version</span>
              <span className="block text-xs font-normal text-muted-foreground">
                Replace this device’s working deck with the latest account copy.
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
              <span className="block font-semibold">Save mine as a copy</span>
              <span className="block text-xs font-normal text-muted-foreground">
                Keep both decks without overwriting either version.
              </span>
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
