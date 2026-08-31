import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PlaytestPlayersDialog } from "@/components/lobby/PlaytestPlayersDialog";
import { resolveOfflineEngine } from "@/lib/offlineEngine";
import { pickRandomDistinct } from "@/lib/utils";
import { savePresetToAccountOnUse } from "@/lib/presetDeckAccount";
import { useGameStore } from "@/stores/useGameStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";

export function useQuickPlaytest(): {
  quickPlaytest: (deck: Deck) => void;
  playtestDialog: ReactNode;
} {
  const navigate = useNavigate();
  const startGame = useGameStore((s) => s.startGame);
  const aiEngine = resolveOfflineEngine();
  const presetDecks = usePresetDecks(aiEngine);
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
      aiEngine,
    ).then((started) => {
      if (started && presetDecks.some((preset) => preset.id === deck.id)) {
        savePresetToAccountOnUse(deck.id);
      }
    });
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
