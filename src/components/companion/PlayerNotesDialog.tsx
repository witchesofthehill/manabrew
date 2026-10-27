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
interface PlayerNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: CompanionPlayer;
}
export function PlayerNotesDialog({ open, onOpenChange, player }: PlayerNotesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-y-auto overscroll-contain">
        <DialogHeader>
          <DialogTitle>Notes — {player.name}</DialogTitle>
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
        placeholder={`e.g. needs 1 mountain \u00B7 holding a Counterspell \u00B7 planeswalker at 4`}
        className="min-h-24 w-full resize-y rounded-md border border-input bg-transparent p-2 text-ui-input focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring touch:min-h-11"
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            setPlayerNotes(player.id, draft);
            onClose();
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  );
}
