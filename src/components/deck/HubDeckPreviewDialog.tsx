import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Swords } from "lucide-react";
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
import { unpublishDeck } from "@/api/hub";
import { useMyHubDecks } from "@/hooks/useMyHubDecks";
import { useQuickPlaytest } from "@/hooks/useQuickPlaytest";
import { groupCards } from "@/views/myDecks.utils";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePublishedDecksStore } from "@/stores/usePublishedDecksStore";
import { useHubStore } from "@/stores/useHubStore";
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
  const { quickPlaytest, playtestDialog } = useQuickPlaytest();
  const { decks: myDecks, refresh } = useMyHubDecks();
  const addSavedDeck = useDeckStore((s) => s.addSavedDeck);
  const loadHubDeck = useDeckStore((s) => s.loadHubDeck);
  const loadDeck = useHubStore((s) => s.loadDeck);
  const published = usePublishedDecksStore((s) => s.published);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const [detail, setDetail] = useState<HubDeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!deckId) return;
    let cancelled = false;
    loadDeck(deckId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load deck");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, loadAttempt, loadDeck]);

  const legacyPublication = published.find((record) => record.hubId === deckId);
  const mine = myDecks.some((deck) => deck.id === deckId) || legacyPublication !== undefined;

  function handleSave() {
    if (!detail) return;
    addSavedDeck(detail.deck as EditorDeck);
    toast.success(`"${detail.name}" saved to My Decks`);
    onClose();
  }

  function handleOpen() {
    if (!detail) return;
    loadHubDeck(detail.deck as EditorDeck);
    onClose();
    navigate("/deck-editor");
  }

  function handleCopyLink() {
    if (!deckId) return;
    const url = `${window.location.origin}/hub?deck=${encodeURIComponent(deckId)}`;
    void navigator.clipboard.writeText(url);
    toast.success("Share link copied — anyone can open and play this deck");
  }

  function handlePlaytest() {
    if (!detail) return;
    onClose();
    quickPlaytest(detail.deck);
  }

  async function handleUnpublish() {
    if (!deckId || !mine) return;
    setBusy(true);
    try {
      await unpublishDeck(deckId, legacyPublication?.managementToken);
      removePublished(deckId);
      await refresh();
      toast.success(`"${detail?.name ?? "Deck"}" removed from the Deck Hub`);
      onClose();
      onUnpublished?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removing failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open={deckId !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="truncate">
                {detail?.name ?? (error ? "Deck unavailable" : "Loading…")}
              </span>
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
            {error && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLoadAttempt((value) => value + 1)}
              >
                Retry
              </Button>
            )}
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
            <Button variant="outline" size="sm" disabled={!deckId} onClick={handleCopyLink}>
              Copy link
            </Button>
            <Button variant="outline" size="sm" disabled={!detail} onClick={handleOpen}>
              View snapshot
            </Button>
            <Button variant="outline" size="sm" disabled={!detail} onClick={handleSave}>
              Make editable copy
            </Button>
            <Button size="sm" disabled={!detail} onClick={handlePlaytest}>
              <Swords className="mr-1 h-3.5 w-3.5" />
              Playtest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {playtestDialog}
    </>
  );
}
