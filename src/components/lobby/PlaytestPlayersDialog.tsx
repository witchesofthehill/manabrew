import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Swords, Users } from "lucide-react";
import { Trans } from "@lingui/react/macro";
interface PlaytestPlayersDialogProps {
  open: boolean;
  onChoose: (opponentCount: number) => void;
  onCancel: () => void;
}
export function PlaytestPlayersDialog({ open, onChoose, onCancel }: PlaytestPlayersDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <Trans>Playtest</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>How many players?</Trans>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => onChoose(3)}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Users className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">
                <Trans>4-player pod</Trans>
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              <Trans>You and three AI opponents. The real thing.</Trans>
            </p>
          </button>
          <button
            onClick={() => onChoose(1)}
            className="text-left rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <Swords className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">
                <Trans>1v1</Trans>
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-snug">
              <Trans>You and one AI opponent. Faster turns, quicker goldfishing.</Trans>
            </p>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
