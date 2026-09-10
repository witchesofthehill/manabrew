import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanionStore } from "@/stores/useCompanionStore";
import type { CompanionPlayer } from "@/stores/useCompanionStore.types";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
interface PlayerNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: CompanionPlayer;
}
export function PlayerNotesDialog({ open, onOpenChange, player }: PlayerNotesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Notes — {player.name}</Trans>
          </DialogTitle>
        </DialogHeader>
        {open && <PlayerNotesForm player={player} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
function PlayerNotesForm({ player, onClose }: { player: CompanionPlayer; onClose: () => void }) {
  const setPlayerNotes = useCompanionStore((s) => s.setPlayerNotes);
  const [draft, setDraft] = useState(player.notes ?? "");
  return (
    <>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={6}
        autoFocus
        placeholder={i18n._(
          msg`e.g. needs 1 mountain \u00B7 holding a Counterspell \u00B7 planeswalker at 4`,
        )}
        className="w-full resize-y rounded-md border border-input bg-transparent p-2 text-sm pointer-coarse:text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          onClick={() => {
            setPlayerNotes(player.id, draft);
            onClose();
          }}
        >
          <Trans>Save</Trans>
        </Button>
      </DialogFooter>
    </>
  );
}
