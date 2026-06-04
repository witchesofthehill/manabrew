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
      <DialogContent>
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
        placeholder="e.g. needs 1 mountain · holding a Counterspell · planeswalker at 4"
        className="w-full resize-y rounded-md border border-input bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
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
