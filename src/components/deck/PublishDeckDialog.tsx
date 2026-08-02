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
import { isFeatureEnabled } from "@/featureFlags";

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
  const publishEnabled = isFeatureEnabled("accounts") && isFeatureEnabled("deckHub");
  const account = useAuthStore((s) => s.account);
  const authStatus = useAuthStore((s) => s.status);
  const showSignIn = useSignInDialog((s) => s.show);
  const published = usePublishedDecksStore((s) => s.published);
  const addPublished = usePublishedDecksStore((s) => s.addPublished);
  const removePublished = usePublishedDecksStore((s) => s.removePublished);
  const { refresh } = useMyHubDecks();
  const capabilities = useHubStore((s) => s.capabilities);
  const capabilitiesLoaded = useHubStore((s) => s.capabilitiesLoaded);
  const capabilitiesError = useHubStore((s) => s.capabilitiesError);
  const loadCapabilities = useHubStore((s) => s.loadCapabilities);
  const savedDecks = useDeckStore((s) => s.savedDecks);
  const linkSavedDeckToAccount = useDeckStore((s) => s.linkSavedDeckToAccount);
  const [busy, setBusy] = useState(false);
  const [confirmingUnpublish, setConfirmingUnpublish] = useState(false);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (publishEnabled && open) void loadCapabilities();
  }, [loadCapabilities, open, publishEnabled]);

  const existing =
    !capabilitiesLoaded || capabilities?.domainVersion === 2
      ? undefined
      : findPublishedByLocalDeckId(published, localDeckId);
  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);
  const signedIn = authStatus === "signedIn" && account !== null;

  async function handlePublish() {
    if (!publishEnabled || !account) return;
    setBusy(true);
    try {
      const detectedCapabilities = capabilitiesLoaded ? capabilities : await loadCapabilities();
      if (!useHubStore.getState().capabilitiesLoaded) {
        throw new Error(
          useHubStore.getState().capabilitiesError ??
            "Could not determine whether Community publishing is available",
        );
      }
      const publishableDeck = toPublishableDeck(deck);
      const localSaved = savedDecks.find((saved) => saved.id === localDeckId);
      if (detectedCapabilities?.domainVersion === 2) {
        let accountDeck;
        if (localSaved?.accountDeckId) {
          if (!localSaved.accountVersionNo) {
            throw new Error("Reload this account deck before publishing it.");
          }
          accountDeck = await useAccountDecksStore
            .getState()
            .save(localSaved.accountDeckId, localSaved.accountVersionNo, deck, "Published update");
        } else {
          accountDeck = await useAccountDecksStore.getState().create(deck, "Initial version");
        }
        linkSavedDeckToAccount(
          localDeckId,
          accountDeck.id,
          accountDeck.currentVersionNo,
          accountDeck.deck as EditorDeck,
        );
        await createDeckHubEntry({
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
      } else {
        const response = await publishDeck({
          author: account.handle,
          deck: publishableDeck,
        });
        addPublished({
          hubId: response.id,
          localDeckId,
          name: deck.name,
          managementToken: response.managementToken,
          publishedAt: Date.now(),
        });
      }
      void refresh();
      toast.success(`"${deck.name}" published to Community`);
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
      toast.success(`"${existing.name}" removed from Community`);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Removing failed");
    } finally {
      setBusy(false);
    }
  }

  function handleSignIn() {
    if (!publishEnabled) return;
    showSignIn({
      publishDeckId: localDeckId ?? undefined,
      publishDeck: toPublishableDeck(deck),
      resumeCurrentPublish: resumeInEditor,
    });
  }

  function handleOpenChange(open: boolean) {
    if (busy) return;
    if (!open) setConfirmingUnpublish(false);
    onOpenChange(open);
  }

  return (
    <Dialog open={publishEnabled && open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing
              ? confirmingUnpublish
                ? "Unpublish this deck?"
                : "Published to Community"
              : "Publish to Community"}
          </DialogTitle>
          <DialogDescription>
            {existing
              ? confirmingUnpublish
                ? `Remove the public snapshot of "${existing.name}"? Your local deck will stay in My Decks.`
                : `"${existing.name}" is live on the hub. You can remove it at any time.`
              : !capabilitiesLoaded
                ? `Checking Community support before publishing "${deck.name}".`
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
        {!capabilitiesLoaded && capabilitiesError && (
          <p className="text-sm text-destructive">{capabilitiesError}</p>
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
