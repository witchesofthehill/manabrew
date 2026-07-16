import { useState } from "react";
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
import { publishDeck, unpublishDeck } from "@/api/hub";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { useAuthStore } from "@/stores/useAuthStore";
import {
  findPublishedByLocalDeckId,
  usePublishedDecksStore,
} from "@/stores/usePublishedDecksStore";
import type { Deck } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";

interface PublishDeckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deck: EditorDeck;
  localDeckId: string | null;
}

function toPublishableDeck(deck: EditorDeck): Deck {
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
}: PublishDeckDialogProps) {
  const account = useAuthStore((s) => s.account);
  const authStatus = useAuthStore((s) => s.status);
  const showSignIn = useSignInDialog((s) => s.show);
  const published = usePublishedDecksStore((s) => s.published);
  const addPublished = usePublishedDecksStore((s) => s.addPublished);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const [busy, setBusy] = useState(false);

  const existing = findPublishedByLocalDeckId(published, localDeckId);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);
  const signedIn = authStatus === "signedIn" && account !== null;

  async function handlePublish() {
    if (!account) return;
    setBusy(true);
    try {
      const response = await publishDeck({
        author: account.handle,
        deck: toPublishableDeck(deck),
      });
      addPublished({
        hubId: response.id,
        localDeckId,
        name: deck.name,
        managementToken: response.managementToken,
        publishedAt: Date.now(),
      });
      toast.success(`"${deck.name}" published to the Deck Hub`);
      onOpenChange(false);
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
      toast.success(`"${existing.name}" removed from the Deck Hub`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removing failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSignIn() {
    onOpenChange(false);
    showSignIn();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Published to Deck Hub" : "Publish to Deck Hub"}</DialogTitle>
          <DialogDescription>
            {existing
              ? `"${existing.name}" is live on the hub. You can remove it at any time.`
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
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {existing ? (
            <Button variant="destructive" size="sm" disabled={busy} onClick={handleUnpublish}>
              {busy ? "Removing…" : "Remove from hub"}
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
