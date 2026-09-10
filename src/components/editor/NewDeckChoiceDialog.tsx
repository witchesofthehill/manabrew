import type { ComponentType } from "react";
import { ClipboardPaste, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface NewDeckChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: () => void;
  onFromScratch: () => void;
}
function ChoiceCard({
  icon: Icon,
  title,
  desc,
  onClick,
}: {
  icon: ComponentType<{
    className?: string;
  }>;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 text-left shadow-sm transition-[border-color,background-color] hover:border-primary/50 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
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
          <DialogTitle>
            <Trans>Add a deck</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>How would you like to start?</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            icon={ClipboardPaste}
            title={i18n._(msg`Import from text`)}
            desc="Paste a decklist copied from Moxfield or elsewhere."
            onClick={onImport}
          />
          <ChoiceCard
            icon={Sparkles}
            title={i18n._(msg`From scratch`)}
            desc="Start with an empty deck and add cards yourself."
            onClick={onFromScratch}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
