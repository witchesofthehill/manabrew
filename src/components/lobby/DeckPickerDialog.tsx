import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface DeckPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger?: ReactElement;
  title: string;
  description: string;
  selection?: ReactNode;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  canConfirm: boolean;
  onConfirm: () => void;
  children: ReactNode;
}

export function DeckPickerDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  selection,
  confirmLabel,
  confirmIcon,
  canConfirm,
  onConfirm,
  children,
}: DeckPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className="max-w-6xl h-[min(52rem,calc(var(--visual-viewport-height,100dvh)-2rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom)))] p-0 gap-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)_auto]"
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          const target = event.target as HTMLElement;
          if (
            target.closest(
              "input, button, a, textarea, [contenteditable='true'], [role='combobox'], [role='listbox']",
            )
          )
            return;
          event.preventDefault();
          onConfirm();
        }}
      >
        <div className="px-6 py-4 border-b">
          <DialogTitle className="text-lg font-semibold">{title}</DialogTitle>
          <DialogDescription className="text-ui-body text-muted-foreground mt-0.5">
            {description}
          </DialogDescription>
        </div>
        {children}
        <div className="px-6 py-3 border-t flex flex-col items-stretch justify-between sm:flex-row sm:flex-wrap sm:items-center gap-4 bg-muted/10">
          <div className="flex flex-wrap items-center gap-2 text-ui-label min-w-0">
            {selection ?? (
              <span className="text-muted-foreground italic text-ui-meta">No deck selected</span>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onConfirm}
              disabled={!canConfirm}
              className="gap-1.5"
            >
              {confirmIcon}
              {confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
