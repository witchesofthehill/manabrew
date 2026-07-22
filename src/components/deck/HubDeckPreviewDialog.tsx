import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FormatBadge } from "@/components/game/FormatBadge";
import { fetchHubDeck, unpublishDeck } from "@/api/hub";
import { groupCards } from "@/views/myDecks.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePublishedDecksStore } from "@/stores/usePublishedDecksStore";
import type { DeckCard } from "@/protocol/deck";
import type { HubDeckDetail } from "@/api/hubTypes";
import type { EditorDeck } from "@/types/manabrew";

interface HubDeckPreviewDialogProps {
  deckId: string | null;
  onClose: () => void;
  onUnpublished?: () => void;
}

function CardSection({ title, cards }: { title: string; cards: DeckCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        {title} ({cards.length})
      </p>
      <ul className="text-sm space-y-0.5">
        {groupCards(cards).map((group) => (
          <li key={group.card.identity.name} className="flex gap-2">
            <span className="text-muted-foreground w-6 text-right shrink-0">{group.count}</span>
            <span className="truncate">{group.card.identity.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HubDeckPreviewDialog({
  deckId,
  onClose,
  onUnpublished,
}: HubDeckPreviewDialogProps) {
  const navigate = useNavigate();
  const addSavedDeck = useDeckStore((s) => s.addSavedDeck);
  const loadPresetDeck = useDeckStore((s) => s.loadPresetDeck);
  const published = usePublishedDecksStore((s) => s.published);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const [detail, setDetail] = useState<HubDeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!deckId) return;
    let cancelled = false;
    fetchHubDeck(deckId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load deck");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const mine = published.find((p) => p.hubId === deckId);

  function handleSave() {
    if (!detail) return;
    addSavedDeck(detail.deck as EditorDeck);
    toast.success(`"${detail.name}" saved to My Decks`);
    onClose();
  }

  function handleOpen() {
    if (!detail) return;
    loadPresetDeck(detail.deck as EditorDeck);
    onClose();
    navigate("/deck-editor");
  }

  async function handleUnpublish() {
    if (!mine) return;
    setBusy(true);
    try {
      await unpublishDeck(mine.hubId, mine.managementToken);
      removePublished(mine.hubId);
      toast.success(`"${mine.name}" removed from the Deck Hub`);
      onClose();
      onUnpublished?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removing failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={deckId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="truncate">{detail?.name ?? "Loading…"}</span>
            {detail && <FormatBadge formatId={detail.format ?? "commander"} />}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? `by ${detail.author}${detail.description ? ` — ${detail.description}` : ""}`
              : (error ?? "Fetching deck from the hub…")}
          </DialogDescription>
        </DialogHeader>
        {detail && (
          <ScrollArea className="max-h-[50dvh] pr-3">
            <div className="space-y-3">
              <CardSection title="Commanders" cards={detail.deck.commanders ?? []} />
              <CardSection title="Main deck" cards={detail.deck.cards} />
              <CardSection title="Sideboard" cards={detail.deck.sideboard} />
            </div>
          </ScrollArea>
        )}
        <DialogFooter className="gap-2">
          {mine && (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || !detail}
              onClick={handleUnpublish}
              className="mr-auto"
            >
              {busy ? "Removing…" : "Remove from hub"}
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={!detail} onClick={handleOpen}>
            Open read-only
          </Button>
          <Button size="sm" disabled={!detail} onClick={handleSave}>
            Save to My Decks
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
