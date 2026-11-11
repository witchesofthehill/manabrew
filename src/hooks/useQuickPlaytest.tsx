import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { SelectedDeck } from "@/components/lobby/deckSelection.types";
import { isOfflinePodFormat } from "@/components/lobby/offlineRoster.utils";
import { ROUTES } from "@/lib/constants";
import { trackClientEvent } from "@/lib/clientAnalytics";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { pickRandomDistinct } from "@/lib/utils";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import { useGameStore } from "@/stores/useGameStore";
import { usePresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";
export function useQuickPlaytest(): {
  quickPlaytest: (deck: Deck, savedDeckId?: string) => void;
} {
  const navigate = useNavigate();
  const startGame = useGameStore((s) => s.startGame);
  const aiEngine = resolveOfflineEngine();
  const presetDecks = usePresetDecks(aiEngine);
  function start(deck: Deck) {
    const formatId = deck.format ?? "standard";
    const opponents = pickRandomDistinct(
      presetDecks.filter((preset) => (preset.format ?? "standard") === formatId),
      1,
    );
    void startGame(
      "playtest",
      deck,
      formatId,
      deck.commanders?.[0]?.identity.name,
      opponents.length > 0 ? opponents : [deck],
      aiEngine,
    ).then((started) => {
      if (started && presetDecks.some((preset) => preset.id === deck.id)) {
        savePresetToAccountOnUse(deck.id);
      }
    });
    navigate("/play");
  }
  function quickPlaytest(deck: Deck, savedDeckId?: string) {
    if (deck.cards.length === 0 && (deck.commanders?.length ?? 0) === 0) {
      toast.error(`"${deck.name}" has no cards`);
      return;
    }
    const formatId = deck.format ?? "standard";
    trackClientEvent("feature_used", { feature: "deck_playtest" });
    if (isOfflinePodFormat(formatId)) {
      const preset = savedDeckId
        ? undefined
        : usePresetDecksStore
            .getState()
            .decks.find(
              (candidate) =>
                candidate === deck || (deck.id !== undefined && candidate.id === deck.id),
            );
      const source = preset ? "preset" : "local";
      const sourceId = savedDeckId ?? (preset ? (preset.id ?? preset.name) : "current");
      const preSelectedDeck: SelectedDeck = {
        id: `${source}:${sourceId}`,
        sourceId,
        name: deck.name,
        desc: deck.description,
        color: deck.color,
        sourceDeck: deck,
        source,
        formatId,
        commanderName: deck.commanders?.[0]?.identity.name,
        coverCardName: deck.coverCardName,
      };
      navigate(ROUTES.PLAY_OFFLINE_CONSTRUCTED, {
        state: { preSelectedDeck, gamePurpose: "playtest" },
      });
      return;
    }
    start(deck);
  }
  return { quickPlaytest };
}
