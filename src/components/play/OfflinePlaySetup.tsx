import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { Deck } from "@/protocol/deck";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDecks: Deck[],
    formatId?: string,
    commanderName?: string,
  ) => Promise<boolean>;
}

export function OfflinePlaySetup({
  preSelectedDeckId,
  preSelectedHubDeckId,
  onStart,
}: OfflinePlaySetupProps) {
  return (
    <div className="h-full min-h-0">
      <DeckVsSelector
        preSelectedDeckId={preSelectedDeckId}
        preSelectedHubDeckId={preSelectedHubDeckId}
        onStart={onStart}
      />
    </div>
  );
}
