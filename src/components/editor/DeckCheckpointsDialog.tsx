import { useMemo, useState } from "react";
import { Clock3, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { STORAGE_KEYS } from "@/lib/constants";
import type { EditorDeck } from "@/types/manabrew";

interface DeckCheckpoint {
  id: string;
  deckKey: string;
  name: string;
  createdAt: number;
  deck: EditorDeck;
}

function readCheckpoints(): DeckCheckpoint[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.DECK_CHECKPOINTS) ?? "[]");
    return Array.isArray(parsed) ? (parsed as DeckCheckpoint[]) : [];
  } catch {
    return [];
  }
}

function writeCheckpoints(checkpoints: DeckCheckpoint[]): DeckCheckpoint[] | null {
  const persisted = checkpoints.slice(0, 50);
  while (true) {
    try {
      localStorage.setItem(STORAGE_KEYS.DECK_CHECKPOINTS, JSON.stringify(persisted));
      return persisted;
    } catch {
      if (persisted.length === 0) return null;
      persisted.pop();
    }
  }
}

export function DeckCheckpointsDialog({
  open,
  onOpenChange,
  deck,
  deckKey,
  onRestore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: EditorDeck;
  deckKey: string;
  onRestore: (deck: EditorDeck, name: string) => void;
}) {
  const [name, setName] = useState("");
  const [checkpoints, setCheckpoints] = useState<DeckCheckpoint[]>(readCheckpoints);
  const deckCheckpoints = useMemo(
    () => checkpoints.filter((checkpoint) => checkpoint.deckKey === deckKey),
    [checkpoints, deckKey],
  );

  function saveCheckpoint() {
    const checkpoint: DeckCheckpoint = {
      id: crypto.randomUUID(),
      deckKey,
      name: name.trim() || `Checkpoint ${deckCheckpoints.length + 1}`,
      createdAt: Date.now(),
      deck: { ...structuredClone(deck), playmatUrl: undefined, playmatAssetId: undefined },
    };
    const next = [checkpoint, ...checkpoints];
    const persisted = writeCheckpoints(next);
    if (!persisted?.some((candidate) => candidate.id === checkpoint.id)) {
      toast.error("This checkpoint is too large to save on this device");
      return;
    }
    setCheckpoints(persisted);
    if (persisted.length < next.length) {
      toast.warning("Older checkpoints were removed to free device storage");
    }
    setName("");
  }

  function removeCheckpoint(id: string) {
    const next = checkpoints.filter((checkpoint) => checkpoint.id !== id);
    const persisted = writeCheckpoints(next);
    if (!persisted) {
      toast.error("Could not update checkpoints on this device");
      return;
    }
    setCheckpoints(persisted);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Local checkpoints</DialogTitle>
          <DialogDescription>
            Capture an experiment before changing direction. Checkpoints stay on this device.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            value={name}
            placeholder="Before changing the mana base"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveCheckpoint();
            }}
          />
          <Button onClick={saveCheckpoint}>
            <Plus className="mr-1.5 h-4 w-4" /> Capture
          </Button>
        </div>
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {deckCheckpoints.map((checkpoint) => (
            <div key={checkpoint.id} className="flex items-center gap-3 rounded-lg border p-3">
              <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{checkpoint.name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(checkpoint.createdAt).toLocaleString()} · {checkpoint.deck.cards.length}{" "}
                  main · {checkpoint.deck.sideboard.length} side
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  onRestore(
                    {
                      ...structuredClone(checkpoint.deck),
                      playmatUrl: deck.playmatUrl,
                      playmatAssetId: deck.playmatAssetId,
                    },
                    checkpoint.name,
                  )
                }
              >
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Restore
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${checkpoint.name}`}
                onClick={() => removeCheckpoint(checkpoint.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {deckCheckpoints.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              No checkpoints for this deck yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
