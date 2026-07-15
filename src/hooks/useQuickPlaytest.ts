import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { fetchHubDeck } from "@/api/hub";
import { getDefaultAiEngine } from "@/game/hostedAiPlay";
import { pickRandomDistinct } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";

const COMMANDER_POD_OPPONENTS = 3;

export function useQuickPlaytest(): (deck: Deck) => void {
  const navigate = useNavigate();
  const startGame = useGameStore((s) => s.startGame);
  const presetDecks = usePresetDecks();

  return (deck) => {
    if (deck.cards.length === 0 && (deck.commanders?.length ?? 0) === 0) {
      toast.error(`"${deck.name}" has no cards`);
      return;
    }
    const formatId = deck.format ?? "standard";
    const opponentCount = formatId === "commander" ? COMMANDER_POD_OPPONENTS : 1;
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
  };
}

export function useHubDeckPlaytest(): (deckId: string) => void {
  const quickPlaytest = useQuickPlaytest();
  return (deckId) => {
    void fetchHubDeck(deckId)
      .then((detail) => quickPlaytest(detail.deck))
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load deck"));
  };
}
