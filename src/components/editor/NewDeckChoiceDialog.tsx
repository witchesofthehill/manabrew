import { ClipboardPaste, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface NewDeckChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: () => void;
  onFromScratch: () => void;
}

export function NewDeckChoiceDialog({
  open,
  onOpenChange,
  onImport,
  onFromScratch,
}: NewDeckChoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a deck</DialogTitle>
          <DialogDescription>How would you like to start?</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={onImport}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <ClipboardPaste className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">Import from text</span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              Paste a decklist copied from Moxfield or elsewhere.
            </p>
          </button>
          <button
            onClick={onFromScratch}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">From scratch</span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              Start with an empty deck and add cards yourself.
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
