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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publishDeck, unpublishDeck } from "@/api/hub";
import { stripUsernameTag } from "@/lib/username";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
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

const MAX_AUTHOR_LEN = 50;

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
  const serverUsername = usePreferencesStore((s) => s.serverUsername);
  const published = usePublishedDecksStore((s) => s.published);
  const addPublished = usePublishedDecksStore((s) => s.addPublished);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const [author, setAuthor] = useState(() => stripUsernameTag(serverUsername));
  const [busy, setBusy] = useState(false);

  const existing = findPublishedByLocalDeckId(published, localDeckId);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);
  const trimmedAuthor = author.trim();

  async function handlePublish() {
    setBusy(true);
    try {
      const response = await publishDeck({
        author: trimmedAuthor,
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
        {!existing && (
          <div className="space-y-2">
            <Label htmlFor="hub-author">Author name</Label>
            <Input
              id="hub-author"
              value={author}
              maxLength={MAX_AUTHOR_LEN}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="How you want to be credited"
            />
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {existing ? (
            <Button variant="destructive" size="sm" disabled={busy} onClick={handleUnpublish}>
              {busy ? "Removing…" : "Remove from hub"}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || trimmedAuthor.length === 0 || deck.cards.length === 0}
              onClick={handlePublish}
            >
              {busy ? "Publishing…" : "Publish"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
