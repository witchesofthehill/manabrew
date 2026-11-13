import { useMemo } from "react";
import type { AccountDeckDetail } from "@/api/hubTypes";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useDeckStore } from "@/stores/useDeckStore";
import type { SavedDeck } from "@/stores/useDeckStore";

function mergeOwnedDecks(
  savedDecks: SavedDeck[],
  details: Record<string, AccountDeckDetail>,
): SavedDeck[] {
  const accountSavedDecks: SavedDeck[] = Object.values(details).map((detail) => ({
    id: `account:${detail.id}`,
    deck: detail.deck as SavedDeck["deck"],
    savedAt: new Date(detail.updatedAt).getTime(),
    accountDeckId: detail.id,
    accountVersionNo: detail.currentVersionNo,
  }));
  return [
    ...savedDecks.filter(
      (savedDeck) => !savedDeck.accountDeckId || details[savedDeck.accountDeckId] === undefined,
    ),
    ...accountSavedDecks,
  ];
}

export function ownedDecksNow(): SavedDeck[] {
  const accountId = useAuthStore.getState().account?.id ?? null;
  const accountDecks = useAccountDecksStore.getState();
  const details =
    accountId !== null && accountDecks.accountId === accountId ? accountDecks.details : {};
  return mergeOwnedDecks(useDeckStore.getState().savedDecks, details);
}

export function useOwnedDecks(): SavedDeck[] {
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const { details } = useAccountDecks();

  return useMemo(() => mergeOwnedDecks(savedDecks, details), [details, savedDecks]);
}
