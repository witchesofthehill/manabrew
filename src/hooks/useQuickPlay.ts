import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { isHostedEngineAvailable } from "@/config/webRuntimeConfig";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { ROUTES } from "@/lib/constants";
import { getFormat, validateDeckSections } from "@/lib/formats";
import { getPlatform } from "@/platform";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { prefetchPresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";
import type { EngineKind } from "@/types/server";

function offlineEngine(): EngineKind {
  if (getPlatform().type === "tauri") return "Forge";
  const last = usePreferencesStore.getState().lastOfflineEngine;
  if (last === "Forge" && !isHostedEngineAvailable()) return "Manabrew";
  return last ?? (isHostedEngineAvailable() ? "Forge" : "Manabrew");
}

async function ensurePresets(): Promise<Deck[]> {
  const loaded = usePresetDecksStore.getState().decks;
  if (loaded.length > 0) return loaded;
  await prefetchPresetDecks();
  return usePresetDecksStore.getState().decks;
}

export function useQuickPlay() {
  const navigate = useNavigate();
  const [pendingDeckId, setPendingDeckId] = useState<string | null>(null);
  const pendingRef = useRef(false);

  const quickPlay = useCallback(
    async (savedDeckId: string) => {
      if (pendingRef.current) return;
      const saved = useDeckStore.getState().savedDecks.find((entry) => entry.id === savedDeckId);
      if (!saved) return;
      pendingRef.current = true;
      setPendingDeckId(savedDeckId);
      try {
        const deck = saved.deck;
        const formatId = deck.format ?? "standard";
        const format = getFormat(formatId);
        if (!format) {
          toast.error("This deck uses an unsupported format.");
          navigate(`${ROUTES.DECK_EDITOR}?deck=${encodeURIComponent(savedDeckId)}`);
          return;
        }
        const validation = validateDeckSections(
          { deck, commanderName: deck.commanders?.[0]?.identity.name },
          format,
        );
        if (!validation.legal) {
          toast.warning(validation.errors[0] ?? "This deck is not ready to play.");
          navigate(`${ROUTES.DECK_EDITOR}?deck=${encodeURIComponent(savedDeckId)}`);
          return;
        }
        const opponent = resolveAiOpponent({
          presets: await ensurePresets(),
          savedDecks: useDeckStore.getState().savedDecks,
          formatId,
          last: usePreferencesStore.getState().lastAiOpponent,
        });
        if (!opponent) {
          toast.error("No AI deck available for this format — pick one yourself.");
          navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, {
            state: { preSelectedDeckId: savedDeckId },
          });
          return;
        }
        const started = await useGameStore
          .getState()
          .startGame(
            deck,
            formatId,
            deck.commanders?.[0]?.identity.name,
            opponent.deck,
            offlineEngine(),
          );
        if (!started) return;
        const prefs = usePreferencesStore.getState();
        prefs.setLastOfflineFormatId(formatId);
        prefs.setLastPlayedDeckId(savedDeckId);
        prefs.setLastAiOpponent(
          opponent.source === "preset"
            ? { kind: "preset", id: opponent.id }
            : { kind: "saved", id: opponent.id },
        );
      } finally {
        pendingRef.current = false;
        setPendingDeckId(null);
      }
    },
    [navigate],
  );

  return { quickPlay, pendingDeckId };
}
