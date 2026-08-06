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
import { createDeckHubEntry } from "@/api/hub";
import { useSignInDialog } from "@/stores/useSignInDialogStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useMyDeckHubEntries } from "@/hooks/useMyDeckHubEntries";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useHubStore } from "@/stores/useHubStore";
import { useDeckStore } from "@/stores/useDeckStore";
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
  const { refresh } = useMyDeckHubEntries();
  const capabilities = useHubStore((s) => s.capabilities);
  const capabilitiesLoaded = useHubStore((s) => s.capabilitiesLoaded);
  const capabilitiesError = useHubStore((s) => s.capabilitiesError);
  const loadCapabilities = useHubStore((s) => s.loadCapabilities);
  const savedDecks = useDeckStore((s) => s.savedDecks);
  const linkSavedDeckToAccount = useDeckStore((s) => s.linkSavedDeckToAccount);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(deck.name);
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    if (publishEnabled && open) {
      setTitle(deck.name);
      void loadCapabilities();
    }
  }, [deck.name, loadCapabilities, open, publishEnabled]);

  const cardCount = deck.cards.length + (deck.commanders?.length ?? 0);
  const signedIn = authStatus === "signedIn" && account !== null;

  async function handlePublish() {
    if (!publishEnabled || !account) return;
    setBusy(true);
    try {
      if (!capabilitiesLoaded) await loadCapabilities();
      if (!useHubStore.getState().capabilitiesLoaded) {
        throw new Error(
          useHubStore.getState().capabilitiesError ??
            "Could not determine whether Community publishing is available",
        );
      }
      const localSaved = savedDecks.find((saved) => saved.id === localDeckId);
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
        title: title.trim(),
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
      void refresh();
      toast.success(`"${title.trim()}" published to Community`);
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publishing failed");
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
    onOpenChange(open);
  }

  return (
    <Dialog open={publishEnabled && open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Publish to Community</DialogTitle>
          <DialogDescription>
            {!capabilitiesLoaded
              ? `Checking Community support before publishing "${deck.name}".`
              : `Publish the current version of "${deck.name}" (${cardCount} cards) as a new public entry. You can publish the same deck more than once.`}
          </DialogDescription>
        </DialogHeader>
        {signedIn ? (
          <p className="text-sm text-muted-foreground">
            Publishing as <span className="font-medium text-foreground">@{account.handle}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Publishing needs a Manabrew account, so the deck stays yours and you can remove it from
            any device.
          </p>
        )}
        {signedIn && (
          <div className="space-y-1.5">
            <label htmlFor="deckhub-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="deckhub-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              How the deck appears in Community. Defaults to the deck name.
            </p>
          </div>
        )}
        {capabilities?.tags && signedIn && (
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
            Cancel
          </Button>
          {signedIn ? (
            <Button
              size="sm"
              disabled={busy || deck.cards.length === 0 || title.trim().length === 0}
              onClick={handlePublish}
            >
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
