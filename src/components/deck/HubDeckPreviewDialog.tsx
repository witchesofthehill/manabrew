import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Loader2, MoreHorizontal, Swords, Users } from "lucide-react";
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
import { DeckCardBrowser } from "@/components/deck/DeckCardBrowser";
import { EditDeckHubEntryDialog } from "@/components/deck/EditDeckHubEntryDialog";
import { FormatBadge } from "@/components/game/FormatBadge";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { removeDeckHubEntry, unpublishDeck } from "@/api/hub";
import { useMyHubDecks } from "@/hooks/useMyHubDecks";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useDeckStore } from "@/stores/useDeckStore";
import { usePublishedDecksStore } from "@/stores/usePublishedDecksStore";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useHubStore } from "@/stores/useHubStore";
import type { DeckHubEntryDetail, HubDeckDetail } from "@/api/hubTypes";
import type { EditorDeck } from "@/types/manabrew";
import { ROUTES } from "@/lib/constants";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";

interface HubDeckPreviewDialogProps {
  deckId: string | null;
  onClose: () => void;
  onUnpublished?: () => void;
  onViewSnapshot?: () => void;
}

export function HubDeckPreviewDialog({
  deckId,
  onClose,
  onUnpublished,
  onViewSnapshot,
}: HubDeckPreviewDialogProps) {
  const navigate = useNavigate();
  const {
    decks: myDecks,
    loading: ownershipLoading,
    error: ownershipError,
    signedIn,
    refresh,
  } = useMyHubDecks();
  const addSavedDeck = useDeckStore((s) => s.addSavedDeck);
  const loadAccountDeck = useDeckStore((s) => s.loadAccountDeck);
  const loadHubDeck = useDeckStore((s) => s.loadHubDeck);
  const loadDeck = useHubStore((s) => s.loadDeck);
  const loadEntry = useHubStore((s) => s.loadEntry);
  const removeDeck = useHubStore((s) => s.removeDeck);
  const domainV2 = useHubStore((s) => s.capabilities?.domainVersion === 2);
  const published = usePublishedDecksStore((s) => s.published);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const [detail, setDetail] = useState<HubDeckDetail | null>(null);
  const [entryDetail, setEntryDetail] = useState<DeckHubEntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [editingPublication, setEditingPublication] = useState(false);
  const { details: accountDeckDetails } = useAccountDecks();

  useEffect(() => {
    setDetail(null);
    setEntryDetail(null);
    setError(null);
    setConfirmingUnpublish(false);
    setEditingPublication(false);
    if (!deckId) return;
    let cancelled = false;
    const request = domainV2
      ? loadEntry(deckId).then((entry) => ({
          entry,
          detail: {
            id: entry.id,
            name: entry.title,
            author: entry.author,
            description: entry.summary,
            format: entry.format,
            commanders: entry.commanders,
            colors: entry.colors,
            cardCount: entry.cardCount,
            coverCardName: entry.coverCardName,
            coverImageUrl: entry.coverImageUrl,
            createdAt: entry.publishedAt,
            deck: entry.deck,
          } satisfies HubDeckDetail,
        }))
      : loadDeck(deckId).then((detail) => ({ entry: null, detail }));
    request
      .then(({ entry, detail: loadedDetail }) => {
        if (!cancelled) {
          setEntryDetail(entry);
          setDetail(loadedDetail);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load deck");
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, domainV2, loadAttempt, loadDeck, loadEntry]);

  const legacyPublication = published.find((record) => record.hubId === deckId);
  const mine =
    entryDetail?.ownedByViewer === true ||
    myDecks.some((deck) => deck.id === deckId) ||
    legacyPublication !== undefined;
  const linkedAccountDeck = entryDetail
    ? (accountDeckDetails[entryDetail.deckId] ??
      (entryDetail.presetKey
        ? Object.values(accountDeckDetails).find(
            (deck) => deck.derivedFromPresetKey === entryDetail.presetKey,
          )
        : undefined))
    : undefined;
  const visibleCardCount = detail
    ? detail.deck.cards.length +
      detail.deck.sideboard.length +
      (detail.deck.commanders?.length ?? 0) +
      (detail.deck.companion ? 1 : 0) +
      (detail.deck.maybeboard?.length ?? 0) +
      (detail.deck.attractions?.length ?? 0) +
      (detail.deck.contraptions?.length ?? 0) +
      (detail.deck.schemes?.length ?? 0) +
      (detail.deck.planes?.length ?? 0)
    : 0;
  const colorCost = detail?.colors
    .split("")
    .map((color) => `{${color}}`)
    .join("");

  async function handleSave() {
    if (!detail) return;
    if (entryDetail?.presetKey && signedIn) {
      setBusy(true);
      try {
        await useAccountDecksStore.getState().forkPreset(entryDetail.presetKey);
        toast.success(`"${detail.name}" added to your account decks`);
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to save preset");
      } finally {
        setBusy(false);
      }
      return;
    }
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

  function handleOpenAccountDeck() {
    if (!linkedAccountDeck) {
      handleOpen();
      return;
    }
    const id = loadAccountDeck(
      linkedAccountDeck.id,
      linkedAccountDeck.currentVersionNo,
      linkedAccountDeck.deck as EditorDeck,
    );
    onClose();
    navigate(
      { pathname: ROUTES.DECK_EDITOR, search: `?deck=${encodeURIComponent(id)}` },
      { state: { deckEditorFromList: true } },
    );
  }

  async function handleCopyLink() {
    if (!deckId) return;
    const entryRef = entryDetail?.slug ?? deckId;
    const url = `${window.location.origin}/hub?deck=${encodeURIComponent(entryRef)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied — anyone can open and play this deck");
    } catch {
      toast.error("Couldn’t copy the share link");
    }
  }

  function handlePlayOffline() {
    if (!deckId) return;
    savePresetToAccountOnUse(entryDetail?.presetKey);
    onClose();
    navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedHubDeckId: deckId } });
  }

  function handleMultiplayer() {
    if (!deckId) return;
    savePresetToAccountOnUse(entryDetail?.presetKey);
    onClose();
    navigate(ROUTES.LOBBY, { state: { preferredHubDeckId: deckId } });
  }

  async function handleUnpublish() {
    if (!deckId || !mine) return;
    setBusy(true);
    try {
      if (domainV2) {
        await removeDeckHubEntry(deckId);
      } else {
        await unpublishDeck(deckId, legacyPublication?.managementToken);
      }
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
        <DialogContent className="flex h-[calc(100dvh-1rem-var(--safe-area-inset-top)-var(--safe-area-inset-bottom))] w-[calc(100vw-1rem)] max-w-7xl flex-col gap-0 overflow-hidden p-0 sm:h-[90dvh] sm:w-[94vw]">
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left sm:px-5">
            <DialogTitle className="truncate">
              {detail?.name ?? (error ? "Deck unavailable" : "Loading…")}
            </DialogTitle>
            <DialogDescription className="line-clamp-2">
              {detail
                ? `by ${detail.author}${detail.description ? ` — ${detail.description}` : ""}`
                : (error ?? "Fetching deck from the hub…")}
            </DialogDescription>
            {detail && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                <FormatBadge formatId={detail.format ?? detail.deck.format ?? "commander"} />
                {colorCost && <ManaSymbols cost={colorCost} size="sm" className="m-0" />}
                <span>{visibleCardCount} cards</span>
                <span aria-hidden="true">·</span>
                <span>
                  {entryDetail
                    ? `Published version ${entryDetail.publishedVersionNo}`
                    : "Public snapshot"}
                </span>
                {entryDetail?.tags.map((tag) => (
                  <span key={tag.id} className="rounded-full border px-2 py-0.5">
                    {tag.name}
                  </span>
                ))}
              </div>
            )}
          </DialogHeader>

          {error ? (
            <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
              <div>
                <p className="text-sm font-medium">This deck could not be loaded</p>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setLoadAttempt((value) => value + 1)}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : detail ? (
            <DeckCardBrowser deck={detail.deck} />
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading deck…
              </div>
            </div>
          )}

          <div className="shrink-0 border-t bg-background/95 px-3 py-2 backdrop-blur sm:px-4">
            {signedIn && ownershipError && !legacyPublication && (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
                <span className="min-w-0 break-words">Couldn’t verify deck ownership.</span>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  Retry
                </Button>
              </div>
            )}
            {mine && !ownershipLoading && confirmingUnpublish ? (
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
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm" disabled={!detail} className="col-span-2">
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
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!detail || busy}
                  onClick={
                    mine || linkedAccountDeck ? handleOpenAccountDeck : () => void handleSave()
                  }
                >
                  {linkedAccountDeck && !mine
                    ? "Open My Copy"
                    : mine
                      ? "Open in Deck Editor"
                      : entryDetail?.presetKey && signedIn
                        ? "Add to My Decks"
                        : "Save editable copy"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                      More
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {!mine && (
                      <DropdownMenuItem disabled={!detail} onSelect={handleOpen}>
                        Open in Deck Editor
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem disabled={!deckId} onSelect={() => void handleCopyLink()}>
                      Copy share link
                    </DropdownMenuItem>
                    {mine && !ownershipLoading && (
                      <>
                        {entryDetail && (
                          <DropdownMenuItem onSelect={() => setEditingPublication(true)}>
                            Edit publication
                          </DropdownMenuItem>
                        )}
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
          </div>
        </DialogContent>
      </Dialog>
      {entryDetail && (
        <EditDeckHubEntryDialog
          entry={entryDetail}
          open={editingPublication}
          onOpenChange={setEditingPublication}
          onSaved={(updated) => {
            setEntryDetail(updated);
            setDetail((current) =>
              current
                ? {
                    ...current,
                    name: updated.title,
                    description: updated.summary,
                    coverCardName: updated.coverCardName,
                    coverImageUrl: updated.coverImageUrl,
                  }
                : current,
            );
          }}
        />
      )}
    </>
  );
}
