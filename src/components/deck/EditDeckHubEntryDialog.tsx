import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHubStore } from "@/stores/useHubStore";
import type { DeckHubEntryDetail } from "@/api/hubTypes";

interface EditDeckHubEntryDialogProps {
  entry: DeckHubEntryDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (entry: DeckHubEntryDetail) => void;
}

export function EditDeckHubEntryDialog({
  entry,
  open,
  onOpenChange,
  onSaved,
}: EditDeckHubEntryDialogProps) {
  const updateEntry = useHubStore((state) => state.updateEntry);
  const [title, setTitle] = useState(entry.title);
  const [summary, setSummary] = useState(entry.summary ?? "");
  const [tagInput, setTagInput] = useState(entry.tags.map((tag) => tag.name).join(", "));
  const [coverCardName, setCoverCardName] = useState(entry.coverCardName ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(entry.title);
    setSummary(entry.summary ?? "");
    setTagInput(entry.tags.map((tag) => tag.name).join(", "));
    setCoverCardName(entry.coverCardName ?? "");
  }, [entry, open]);

  const coverCards = useMemo(() => {
    const cards = [
      ...entry.deck.cards,
      ...entry.deck.sideboard,
      ...(entry.deck.commanders ?? []),
      ...(entry.deck.companion ? [entry.deck.companion] : []),
      ...(entry.deck.maybeboard ?? []),
      ...(entry.deck.attractions ?? []),
      ...(entry.deck.contraptions ?? []),
      ...(entry.deck.schemes ?? []),
      ...(entry.deck.planes ?? []),
    ];
    return [...new Map(cards.map((card) => [card.identity.name, card])).values()].sort((a, b) =>
      a.identity.name.localeCompare(b.identity.name),
    );
  }, [entry.deck]);

  const tags = tagInput
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  const invalid =
    title.trim().length === 0 ||
    title.trim().length > 100 ||
    summary.length > 500 ||
    tags.length > 10 ||
    tags.some((tag) => tag.length > 32);

  async function save() {
    if (invalid) return;
    const coverCard = coverCards.find((card) => card.identity.name === coverCardName);
    setBusy(true);
    try {
      const updated = await updateEntry(entry.id, {
        title: title.trim(),
        summary: summary.trim() || undefined,
        tags,
        coverCardId: coverCard?.identity.oracleId,
        coverCardName: coverCard?.identity.name,
      });
      onSaved(updated);
      onOpenChange(false);
      toast.success("Publication details updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update publication");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit publication</DialogTitle>
          <DialogDescription>
            Update how this exact deck version appears in Community discovery and Top Decks.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="deckhub-entry-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="deckhub-entry-title"
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{title.length}/100</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="deckhub-entry-summary" className="text-sm font-medium">
              Summary
            </label>
            <textarea
              id="deckhub-entry-summary"
              value={summary}
              maxLength={500}
              rows={4}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:text-base"
              onChange={(event) => setSummary(event.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">{summary.length}/500</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="deckhub-entry-tags" className="text-sm font-medium">
              Discovery tags
            </label>
            <Input
              id="deckhub-entry-tags"
              value={tagInput}
              maxLength={329}
              placeholder="control, budget, tokens"
              onChange={(event) => setTagInput(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {tags.length}/10 tags. Each tag can contain up to 32 characters.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="deckhub-entry-cover" className="text-sm font-medium">
              Cover card
            </label>
            <select
              id="deckhub-entry-cover"
              value={coverCardName}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm pointer-coarse:text-base"
              onChange={(event) => setCoverCardName(event.target.value)}
            >
              <option value="">Automatic cover</option>
              {coverCards.map((card) => (
                <option key={card.identity.name} value={card.identity.name}>
                  {card.identity.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy || invalid} onClick={() => void save()}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
