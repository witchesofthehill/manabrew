import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { Deck } from "@/protocol/deck";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDeck: Deck,
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
}

export function OfflinePlaySetup({ preSelectedDeckId, onStart }: OfflinePlaySetupProps) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <BreweryBackdrop />
      <div className="relative z-10 h-full min-h-0">
        <DeckVsSelector preSelectedDeckId={preSelectedDeckId} onStart={onStart} />
      </div>
    </div>
  );
}
