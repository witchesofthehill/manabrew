import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { resolveAiOpponent } from "@/lib/aiOpponent";
import { ROUTES } from "@/lib/constants";
import { reportPublishedDeckPlay } from "@/lib/deckPlayEvidence";
import { getFormat } from "@/lib/formats";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { presetSupportsEngine, type PresetDeck } from "@/lib/presetDecks";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import { useDeckStore } from "@/stores/useDeckStore";
import { useGameStore } from "@/stores/useGameStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { prefetchPresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { EngineKind } from "@/protocol";

async function ensurePresets(engine: EngineKind): Promise<PresetDeck[]> {
  if (usePresetDecksStore.getState().decks.length === 0) {
    await prefetchPresetDecks();
  }
  return usePresetDecksStore.getState().decks.filter((deck) => presetSupportsEngine(deck, engine));
}

export function useQuickPlay() {
  const navigate = useNavigate();
  const [pendingDeckId, setPendingDeckId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
          navigate(`${ROUTES.DECK_EDITOR}?deck=${encodeURIComponent(savedDeckId)}`, {
            state: { deckEditorFromList: true },
          });
          return;
        }
        const engine = resolveOfflineEngine();
        const opponent = resolveAiOpponent({
          presets: await ensurePresets(engine),
          savedDecks: useDeckStore.getState().savedDecks,
          formatId,
          last: usePreferencesStore.getState().lastAiOpponent,
        });
        if (!mountedRef.current) return;
        if (!opponent) {
          toast.error("No AI deck available for this format — pick one yourself.");
          navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, {
            state: { preSelectedDeckId: savedDeckId },
          });
          return;
        }
        const started = await useGameStore
          .getState()
          .startGame(deck, formatId, deck.commanders?.[0]?.identity.name, [opponent.deck], engine);
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
        if (mountedRef.current) setPendingDeckId(null);
      }
    },
    [navigate],
  );

  const quickPlayPreset = useCallback(async (preset: PresetDeck) => {
    if (pendingRef.current) return;
    const presetId = preset.id ?? preset.name;
    pendingRef.current = true;
    setPendingDeckId(presetId);
    try {
      const formatId = preset.format ?? "standard";
      if (formatId === "oathbreaker" || getFormat(formatId) === undefined) {
        toast.error("This starter deck uses an unsupported format.");
        return;
      }
      const engine = resolveOfflineEngine();
      if (!presetSupportsEngine(preset, engine)) {
        toast.error(
          `This deck is built for the ${preset.engines?.[0] ?? "Ironsmith"} engine — start a table with that engine from Multiplayer.`,
        );
        return;
      }
      const opponent = resolveAiOpponent({
        presets: await ensurePresets(engine),
        savedDecks: useDeckStore.getState().savedDecks,
        formatId,
        last: usePreferencesStore.getState().lastAiOpponent,
      });
      if (!mountedRef.current) return;
      if (!opponent) {
        toast.error("No AI deck available for this format — pick one yourself.");
        return;
      }
      const started = await useGameStore
        .getState()
        .startGame(
          preset,
          formatId,
          preset.commanders?.[0]?.identity.name,
          [opponent.deck],
          engine,
        );
      if (!started) return;
      void reportPublishedDeckPlay(presetId, preset);
      savePresetToAccountOnUse(preset.id);
      const prefs = usePreferencesStore.getState();
      prefs.setLastOfflineFormatId(formatId);
      prefs.setLastAiOpponent(
        opponent.source === "preset"
          ? { kind: "preset", id: opponent.id }
          : { kind: "saved", id: opponent.id },
      );
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPendingDeckId(null);
    }
  }, []);

  return { quickPlay, quickPlayPreset, pendingDeckId };
}
