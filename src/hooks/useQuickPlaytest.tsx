import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlaytestPlayersDialog } from "@/components/lobby/PlaytestPlayersDialog";
import { getDefaultAiEngine } from "@/game/hostedAiPlay";
import { pickRandomDistinct } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { useHubStore } from "@/stores/useHubStore";
import type { Deck } from "@/protocol/deck";

export function useQuickPlaytest(): {
  quickPlaytest: (deck: Deck) => void;
  playtestDialog: ReactNode;
} {
  const navigate = useNavigate();
  const startGame = useGameStore((s) => s.startGame);
  const presetDecks = usePresetDecks();
  const [pendingDeck, setPendingDeck] = useState<Deck | null>(null);

  function start(deck: Deck, opponentCount: number) {
    const formatId = deck.format ?? "standard";
    const opponents = pickRandomDistinct(
      presetDecks.filter((preset) => (preset.format ?? "standard") === formatId),
      opponentCount,
    );
    void startGame(
      deck,
      formatId,
      deck.commanders?.[0]?.identity.name,
      opponents.length > 0 ? opponents : [deck],
      getDefaultAiEngine(),
    );
    navigate("/play");
  }

  function quickPlaytest(deck: Deck) {
    if (deck.cards.length === 0 && (deck.commanders?.length ?? 0) === 0) {
      toast.error(`"${deck.name}" has no cards`);
      return;
    }
    if ((deck.format ?? "standard") === "commander") {
      setPendingDeck(deck);
      return;
    }
    start(deck, 1);
  }

  const playtestDialog = pendingDeck ? (
    <PlaytestPlayersDialog
      open
      onChoose={(opponentCount) => {
        const deck = pendingDeck;
        setPendingDeck(null);
        start(deck, opponentCount);
      }}
      onCancel={() => setPendingDeck(null)}
    />
  ) : null;

  return { quickPlaytest, playtestDialog };
}

export function useHubDeckPlaytest(quickPlaytest: (deck: Deck) => void): (deckId: string) => void {
  return (deckId) => {
    void useHubStore
      .getState()
      .loadDeck(deckId)
      .then((detail) => quickPlaytest(detail.deck))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load deck"));
  };
}
