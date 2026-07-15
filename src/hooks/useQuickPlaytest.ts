import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { getDefaultAiEngine } from "@/game/hostedAiPlay";
import { pickRandom } from "@/lib/utils";
import { useGameStore } from "@/stores/useGameStore";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck } from "@/protocol/deck";

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
    const opponent =
      pickRandom(presetDecks.filter((preset) => (preset.format ?? "standard") === formatId)) ??
      deck;
    void startGame(
      deck,
      formatId,
      deck.commanders?.[0]?.identity.name,
      opponent,
      getDefaultAiEngine(),
    );
    navigate("/play");
  };
}
