import { useMemo } from "react";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useDeckStore } from "@/stores/useDeckStore";
import type { SavedDeck } from "@/stores/useDeckStore";

export function useOwnedDecks(): SavedDeck[] {
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const { details } = useAccountDecks();

  return useMemo(() => {
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
  }, [details, savedDecks]);
}
