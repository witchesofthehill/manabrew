import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { Deck } from "@/protocol/deck";
import type { ReactNode } from "react";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  leadingControl?: ReactNode;
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
  leadingControl,
  onStart,
}: OfflinePlaySetupProps) {
  return (
    <div className="h-full min-h-0">
      <DeckVsSelector
        preSelectedDeckId={preSelectedDeckId}
        preSelectedHubDeckId={preSelectedHubDeckId}
        leadingControl={leadingControl}
        onStart={onStart}
      />
    </div>
  );
}
