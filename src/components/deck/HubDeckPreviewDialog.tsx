import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, MoreHorizontal, Swords, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { ROUTES } from "@/lib/constants";

interface HubDeckPreviewDialogProps {
  deckId: string | null;
  onClose: () => void;
  onUnpublished?: () => void;
  onViewSnapshot?: () => void;
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
  onViewSnapshot,
}: HubDeckPreviewDialogProps) {
  const navigate = useNavigate();
  const { quickPlaytest, playtestDialog } = useQuickPlaytest();
  const {
    decks: myDecks,
    loading: ownershipLoading,
    error: ownershipError,
    signedIn,
    refresh,
  } = useMyHubDecks();
  const addSavedDeck = useDeckStore((s) => s.addSavedDeck);
  const loadHubDeck = useDeckStore((s) => s.loadHubDeck);
  const loadDeck = useHubStore((s) => s.loadDeck);
  const removeDeck = useHubStore((s) => s.removeDeck);
  const published = usePublishedDecksStore((s) => s.published);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const [detail, setDetail] = useState<HubDeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    setConfirmingUnpublish(false);
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
    if (onViewSnapshot) {
      onViewSnapshot();
    } else {
      navigate(ROUTES.DECK_EDITOR, { state: { directToEditor: true } });
    }
  }

  async function handleCopyLink() {
    if (!deckId) return;
    const url = `${window.location.origin}/hub?deck=${encodeURIComponent(deckId)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — anyone can open and play this deck");
    } catch {
      toast.error("Couldn’t copy the share link");
    }
  }

  function handlePlaytest() {
    if (!detail) return;
    onClose();
    quickPlaytest(detail.deck);
  }

  function handlePlayOffline() {
    if (!deckId) return;
    onClose();
    navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedHubDeckId: deckId } });
  }

  function handleMultiplayer() {
    if (!deckId) return;
    onClose();
    navigate(ROUTES.LOBBY, { state: { preferredHubDeckId: deckId } });
  }

  async function handleUnpublish() {
    if (!deckId || !mine) return;
    setBusy(true);
    try {
      await unpublishDeck(deckId, legacyPublication?.managementToken);
      setConfirmingUnpublish(false);
      removePublished(deckId);
      removeDeck(deckId);
      void refresh();
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
        <DialogContent className="flex max-w-lg flex-col overflow-hidden">
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
            <ScrollArea className="min-h-0 max-h-[50dvh] pr-3">
              <div className="space-y-3">
                <CardSection title="Commanders" cards={detail.deck.commanders ?? []} />
                <CardSection title="Main deck" cards={detail.deck.cards} />
                <CardSection title="Sideboard" cards={detail.deck.sideboard} />
              </div>
            </ScrollArea>
          )}
          {signedIn && ownershipError && !legacyPublication && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span className="min-w-0 break-words">Couldn’t verify deck ownership.</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </div>
          )}
          {mine && !ownershipLoading && confirmingUnpublish && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span role="status" aria-live="polite" className="mr-auto text-xs text-destructive">
                Remove this public snapshot?
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmingUnpublish(false)}
              >
                Keep published
              </Button>
              <Button
                variant="destructive"
                size="sm"
                autoFocus
                disabled={busy || !detail}
                onClick={handleUnpublish}
              >
                {busy ? "Unpublishing…" : "Confirm unpublish"}
              </Button>
            </div>
          )}
          {error ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              Retry
            </Button>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
              <Button size="sm" disabled={!detail} onClick={handlePlaytest}>
                Playtest
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="sm" disabled={!detail}>
                    Play
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={handlePlayOffline}>
                    <Swords />
                    Play Offline
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleMultiplayer}>
                    <Users />
                    Multiplayer
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" disabled={!detail} onClick={handleSave}>
                Save editable copy
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!detail} onSelect={handleOpen}>
                    View read-only snapshot
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!deckId} onSelect={() => void handleCopyLink()}>
                    Copy share link
                  </DropdownMenuItem>
                  {mine && !ownershipLoading && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        disabled={busy || !detail}
                        className="text-destructive focus:text-destructive"
                        onSelect={() => setConfirmingUnpublish(true)}
                      >
                        Unpublish
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {playtestDialog}
    </>
  );
}
