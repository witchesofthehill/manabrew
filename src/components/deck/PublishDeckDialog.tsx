import { useEffect, useState } from "react";
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
import { createDeckHubEntry, publishDeck, unpublishDeck } from "@/api/hub";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useMyHubDecks } from "@/hooks/useMyHubDecks";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useHubStore } from "@/stores/useHubStore";
import { useDeckStore } from "@/stores/useDeckStore";
import {
  findPublishedByLocalDeckId,
  usePublishedDecksStore,
} from "@/stores/usePublishedDecksStore";
import type { EditorDeck } from "@/types/manabrew";

interface PublishDeckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: EditorDeck;
  localDeckId: string | null;
  resumeInEditor?: boolean;
}

function toPublishableDeck(deck: EditorDeck): EditorDeck {
  const { customTags: _customTags, cardTags: _cardTags, ...wireDeck } = deck;
  return {
    ...wireDeck,
    id: undefined,
    version: undefined,
    playmat: undefined,
    playmatSettings: undefined,
    stackPositions: undefined,
  };
}

export function PublishDeckDialog({
  open,
  onOpenChange,
  deck,
  localDeckId,
  resumeInEditor = false,
}: PublishDeckDialogProps) {
  const account = useAuthStore((s) => s.account);
  const authStatus = useAuthStore((s) => s.status);
  const showSignIn = useSignInDialog((s) => s.show);
  const published = usePublishedDecksStore((s) => s.published);
  const addPublished = usePublishedDecksStore((s) => s.addPublished);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const { refresh } = useMyHubDecks();
  const capabilities = useHubStore((s) => s.capabilities);
  const loadCapabilities = useHubStore((s) => s.loadCapabilities);
  const savedDecks = useDeckStore((s) => s.savedDecks);
  const linkSavedDeckToAccount = useDeckStore((s) => s.linkSavedDeckToAccount);
  const [busy, setBusy] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (open) void loadCapabilities();
  }, [loadCapabilities, open]);

  const existing =
    capabilities?.domainVersion === 2
      ? undefined
      : findPublishedByLocalDeckId(published, localDeckId);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);
  const signedIn = authStatus === "signedIn" && account !== null;

  async function handlePublish() {
    if (!account) return;
    setBusy(true);
    try {
      const publishableDeck = toPublishableDeck(deck);
      const localSaved = savedDecks.find((saved) => saved.id === localDeckId);
      let publishedLocalDeckId = localDeckId;
      let response: { id: string; managementToken: string };
      if (capabilities?.domainVersion === 2) {
        const accountDeck = localSaved?.accountDeckId
          ? await useAccountDecksStore
              .getState()
              .save(
                localSaved.accountDeckId,
                localSaved.accountVersionNo ?? 1,
                publishableDeck,
                "Published update",
              )
          : await useAccountDecksStore.getState().create(publishableDeck, "Initial version");
        if (localDeckId) {
          linkSavedDeckToAccount(
            localDeckId,
            accountDeck.id,
            accountDeck.currentVersionNo,
            accountDeck.deck as EditorDeck,
          );
          publishedLocalDeckId = `account:${accountDeck.id}`;
        }
        const entry = await createDeckHubEntry({
          deckId: accountDeck.id,
          publishedVersionId: accountDeck.currentVersionId,
          title: deck.name,
          summary: deck.description,
          tags: tagInput
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          coverCardId: [...deck.cards, ...(deck.commanders ?? []), ...deck.sideboard].find(
            (card) => card.identity.name === deck.coverCardName,
          )?.identity.oracleId,
          coverCardName: deck.coverCardName,
        });
        response = { id: entry.id, managementToken: "" };
      } else {
        response = await publishDeck({
          author: account.handle,
          deck: publishableDeck,
        });
      }
      addPublished({
        hubId: response.id,
        localDeckId: publishedLocalDeckId,
        name: deck.name,
        managementToken: response.managementToken,
        publishedAt: Date.now(),
      });
      void refresh();
      toast.success(`"${deck.name}" published to the Deck Hub`);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publishing failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpublish() {
    if (!existing) return;
    setBusy(true);
    try {
      await unpublishDeck(existing.hubId, existing.managementToken);
      removePublished(existing.hubId);
      void refresh();
      toast.success(`"${existing.name}" removed from the Deck Hub`);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removing failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSignIn() {
    showSignIn({
      publishDeckId: localDeckId ?? undefined,
      publishDeck: toPublishableDeck(deck),
      resumeCurrentPublish: resumeInEditor,
    });
  }

  function handleOpenChange(open: boolean) {
    if (!open) setConfirmingUnpublish(false);
    onOpenChange(open);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? confirmingUnpublish
                ? "Unpublish this deck?"
                : "Published to Deck Hub"
              : "Publish to Deck Hub"}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? confirmingUnpublish
                ? `Remove the public snapshot of "${existing.name}"? Your local deck will stay in My Decks.`
                : `"${existing.name}" is live on the hub. You can remove it at any time.`
              : capabilities?.domainVersion === 2
                ? `Publish the current version of "${deck.name}" (${cardCount} cards) as a new public entry. You can publish the same deck more than once.`
                : `Share "${deck.name}" (${cardCount} cards) so other players can browse and try it. Custom playmats and editor tags are not published.`}
          </DialogDescription>
        </DialogHeader>
        {!existing &&
          (signedIn ? (
            <p className="text-sm text-muted-foreground">
              Publishing as <span className="font-medium text-foreground">@{account.handle}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Publishing needs a Manabrew account, so the deck stays yours and you can remove it
              from any device.
            </p>
          ))}
        {!existing && capabilities?.tags && signedIn && (
          <div className="space-y-1.5">
            <label htmlFor="deckhub-tags" className="text-sm font-medium">
              Discovery tags
            </label>
            <Input
              id="deckhub-tags"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="control, budget, tokens"
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">Up to 10 tags, separated by commas.</p>
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
          >
            {confirmingUnpublish ? "Keep published" : "Cancel"}
          </Button>
          {existing ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() =>
                confirmingUnpublish ? void handleUnpublish() : setConfirmingUnpublish(true)
              }
            >
              {busy ? "Unpublishing…" : confirmingUnpublish ? "Confirm unpublish" : "Unpublish"}
            </Button>
          ) : signedIn ? (
            <Button size="sm" disabled={busy || deck.cards.length === 0} onClick={handlePublish}>
              {busy ? "Publishing…" : "Publish"}
            </Button>
          ) : (
            <Button size="sm" onClick={handleSignIn}>
              Sign in
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
