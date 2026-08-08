import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAccountDecks } from "@/hooks/useAccountDecks";
import { useAccountDecksStore } from "@/stores/useAccountDecksStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { useDeckStore } from "@/stores/useDeckStore";
import type { SavedDeck } from "@/stores/useDeckStore";

export function useLocalDeckAccountSync() {
  const accountId = useAuthStore((state) => state.account?.id ?? null);
  const savedDecks = useDeckStore((state) => state.savedDecks);
  const { available, signedIn, resolved } = useAccountDecks();
  const attemptedAccountIdRef = useRef<string | null>(null);
  const attemptedDeckIdsRef = useRef(new Set<string>());
  const syncingRef = useRef(false);
  const [syncPass, setSyncPass] = useState(0);

  useEffect(() => {
    if (attemptedAccountIdRef.current !== accountId) {
      attemptedAccountIdRef.current = accountId;
      attemptedDeckIdsRef.current.clear();
    }
    if (!accountId || !available || !signedIn || !resolved || syncingRef.current) return;

    const localDecks = savedDecks.filter(
      (saved) => !saved.accountDeckId && !attemptedDeckIdsRef.current.has(saved.id),
    );
    if (localDecks.length === 0) return;

    syncingRef.current = true;
    void (async () => {
      for (const saved of localDecks) {
        attemptedDeckIdsRef.current.add(saved.id);
        try {
          const detail = await useAccountDecksStore
            .getState()
            .create(saved.deck, "Imported from local decks");
          if (useAuthStore.getState().account?.id !== accountId) continue;
          useDeckStore
            .getState()
            .linkSavedDeckToAccount(
              saved.id,
              detail.id,
              detail.currentVersionNo,
              detail.deck as SavedDeck["deck"],
            );
        } catch (error) {
          toast.error(
            error instanceof Error
              ? `Could not sync "${saved.deck.name}": ${error.message}`
              : `Could not sync "${saved.deck.name}" to your account`,
          );
        }
      }
    })().finally(() => {
      syncingRef.current = false;
      setSyncPass((pass) => pass + 1);
    });
  }, [accountId, available, resolved, savedDecks, signedIn, syncPass]);
}
