import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AboutContent } from "@/components/AboutContent";

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>About ManaBrew</DialogTitle>
          <DialogDescription>
            A fan-made, non-commercial client for Magic: The Gathering — free and open source.
          </DialogDescription>
        </DialogHeader>
        <AboutContent />
      </DialogContent>
    </Dialog>
  );
}
