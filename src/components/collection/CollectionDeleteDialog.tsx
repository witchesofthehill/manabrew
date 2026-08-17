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
          <DialogTitle>Delete entire collection?</DialogTitle>
          <DialogDescription>
            This will permanently remove all {entryCount} collection entries from your account. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
            {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {deleting ? "Deleting…" : "Delete collection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
