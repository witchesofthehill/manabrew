import { useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface CollectionDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryCount: number;
  onDelete: () => Promise<void>;
}
export function CollectionDeleteDialog({
  open,
  onOpenChange,
  entryCount,
  onDelete,
}: CollectionDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete();
    } catch {
      setDeleting(false);
      return;
    }
    setDeleting(false);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !deleting && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <Trans>Delete entire collection?</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              This will permanently remove all {entryCount} collection entries from your account.
              This action cannot be undone.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
            {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {deleting ? i18n._(msg`Deleting\u2026`) : i18n._(msg`Delete collection`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
