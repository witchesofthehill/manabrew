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
import { resolveDeckName } from "@/lib/deckName";
import { Trans } from "@lingui/react/macro";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
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
    name: resolveDeckName(deck.name, deck.commanders),
    id: undefined,
    version: undefined,
    playmatUrl: undefined,
    playmatAssetId: undefined,
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
  const resolvedDeckName = resolveDeckName(deck.name, deck.commanders);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(resolvedDeckName);
  const [tagInput, setTagInput] = useState("");
  useEffect(() => {
    if (publishEnabled && open) {
      setTitle(resolvedDeckName);
      void loadCapabilities();
    }
  }, [loadCapabilities, open, publishEnabled, resolvedDeckName]);
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
            i18n._(msg`Could not determine whether Community publishing is available`),
        );
      }
      const localSaved = savedDecks.find((saved) => saved.id === localDeckId);
      let accountDeck;
      if (localSaved?.accountDeckId) {
        if (!localSaved.accountVersionNo) {
          throw new Error(i18n._(msg`Reload this account deck before publishing it.`));
        }
        accountDeck = await useAccountDecksStore
          .getState()
          .save(
            localSaved.accountDeckId,
            localSaved.accountVersionNo,
            deck,
            i18n._(msg`Published update`),
          );
      } else {
        accountDeck = await useAccountDecksStore
          .getState()
          .create(deck, i18n._(msg`Initial version`));
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
      toast.success(i18n._(msg`"${title.trim()}" published to Community`));
      handleOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : i18n._(msg`Publishing failed`));
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
          <DialogTitle>
            <Trans>Publish to Community</Trans>
          </DialogTitle>
          <DialogDescription>
            {!capabilitiesLoaded
              ? i18n._(msg`Checking Community support before publishing "${resolvedDeckName}".`)
              : i18n._(
                  msg`Publish the current version of "${resolvedDeckName}" (${cardCount} cards) as a new public entry. You can publish the same deck more than once.`,
                )}
          </DialogDescription>
        </DialogHeader>
        {signedIn ? (
          <p className="text-sm text-muted-foreground">
            <Trans>
              Publishing as <span className="font-medium text-foreground">@{account.handle}</span>
            </Trans>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            <Trans>
              Publishing needs a Manabrew account, so the deck stays yours and you can remove it
              from any device.
            </Trans>
          </p>
        )}
        {signedIn && (
          <div className="space-y-1.5">
            <label htmlFor="deckhub-title" className="text-sm font-medium">
              <Trans>Title</Trans>
            </label>
            <Input
              id="deckhub-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              <Trans>How the deck appears in Community. Defaults to the deck name.</Trans>
            </p>
          </div>
        )}
        {capabilities?.tags && signedIn && (
          <div className="space-y-1.5">
            <label htmlFor="deckhub-tags" className="text-sm font-medium">
              <Trans>Discovery tags</Trans>
            </label>
            <Input
              id="deckhub-tags"
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder={i18n._(msg`control, budget, tokens`)}
              maxLength={200}
            />
            <p className="text-xs text-muted-foreground">
              <Trans>Up to 10 tags, separated by commas.</Trans>
            </p>
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
            <Trans>Cancel</Trans>
          </Button>
          {signedIn ? (
            <Button
              size="sm"
              disabled={busy || deck.cards.length === 0 || title.trim().length === 0}
              onClick={handlePublish}
            >
              {busy ? i18n._(msg`Publishing\u2026`) : i18n._(msg`Publish`)}
            </Button>
          ) : (
            <Button size="sm" onClick={handleSignIn}>
              <Trans>Sign in</Trans>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
