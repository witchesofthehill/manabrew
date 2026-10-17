import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { resolveDeckCards } from "@/lib/limited.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import type { DraftCard } from "@/types/limited";
import type { DeckFormat } from "@/protocol/deck";
interface Props {
  deck: { main: DraftCard[]; sideboard: DraftCard[] };
  defaultDeckName: string;
  targetMainSize: number;
  requireCompleteToSave: boolean;
  format: DeckFormat;
  onSaved?: (name: string) => void;
}
export function LimitedBuildSaveActions({
  deck,
  defaultDeckName,
  targetMainSize,
  requireCompleteToSave,
  format,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultDeckName);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const save = async () => {
    if (
      busyRef.current ||
      !name.trim() ||
      (!deck.main.length && !deck.sideboard.length) ||
      (requireCompleteToSave && deck.main.length < targetMainSize)
    )
      return;
    busyRef.current = true;
    setBusy(true);
    try {
      const [cards, sideboard] = await Promise.all([
        resolveDeckCards(deck.main),
        resolveDeckCards(deck.sideboard),
      ]);
      useDeckStore.getState().addSavedDeck({
        name: name.trim(),
        format,
        cards,
        sideboard,
        draft: cards.length < targetMainSize,
      });
      setOpen(false);
      toast.success(`Saved "${name.trim()}" to My Decks.`);
      onSaved?.(name.trim());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the deck.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || (!deck.main.length && !deck.sideboard.length)}
        onClick={() => {
          setName(defaultDeckName);
          setOpen(true);
        }}
      >
        Save to My Decks
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save to My Decks</DialogTitle>
            <DialogDescription>
              Every acquired card outside the Mainboard is saved in the complete sideboard,
              including Pool and Maybeboard.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            className="grid gap-3"
          >
            <Label htmlFor="limited-save-name">Deck name</Label>
            <Input
              id="limited-save-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              disabled={busy}
            />
            <p className="text-sm text-muted-foreground">
              Mainboard {deck.main.length} · Complete sideboard {deck.sideboard.length}
            </p>
            {deck.main.length < targetMainSize && (
              <p className="text-sm text-warning">
                {targetMainSize - deck.main.length} more Mainboard cards needed.{" "}
                {requireCompleteToSave
                  ? "Complete the deck before saving."
                  : "Saved as an unfinished deck."}
              </p>
            )}
            <DialogFooter>
              <Button variant="ghost" type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={
                  busy ||
                  !name.trim() ||
                  (requireCompleteToSave && deck.main.length < targetMainSize)
                }
              >
                {busy ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
