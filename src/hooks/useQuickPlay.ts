import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { ROUTES } from "@/lib/constants";
import { getPlatform } from "@/platform";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { prefetchPresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { EngineKind } from "@/types/server";

export function useQuickPlay() {
  const navigate = useNavigate();

  return useCallback(
    async (savedDeckId: string) => {
      const saved = useDeckStore.getState().savedDecks.find((entry) => entry.id === savedDeckId);
      if (!saved) return;
      const deck = saved.deck;
      const formatId = deck.format ?? "standard";

      let presets = usePresetDecksStore.getState().decks;
      if (presets.length === 0) {
        await prefetchPresetDecks();
        presets = usePresetDecksStore.getState().decks;
      }

      const prefs = usePreferencesStore.getState();
      const opponent = resolveAiOpponent({
        presets,
        savedDecks: useDeckStore.getState().savedDecks,
        formatId,
        last: prefs.lastAiOpponent,
      });
      if (!opponent) {
        toast.error("No AI deck available for this format — pick one yourself.");
        navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, { state: { preSelectedDeckId: savedDeckId } });
        return;
      }

      const engine: EngineKind =
        getPlatform().type === "tauri"
          ? "Forge"
          : (prefs.lastOfflineEngine ?? (isHostedEngineAvailable() ? "Forge" : "Manabrew"));
      prefs.setLastPlayedDeckId(savedDeckId);
      prefs.setLastAiOpponent(
        opponent.source === "preset"
          ? { kind: "preset", id: opponent.id }
          : { kind: "saved", id: opponent.id },
      );
      await useGameStore
        .getState()
        .startGame(deck, formatId, deck.commanders?.[0]?.identity.name, opponent.deck, engine);
    },
    [navigate],
  );
}
