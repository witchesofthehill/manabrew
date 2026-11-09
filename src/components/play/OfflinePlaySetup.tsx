import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { SelectedDeck } from "@/components/lobby/deckSelection.types";
import type { Deck } from "@/protocol/deck";
import type { ReactNode } from "react";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  preSelectedDeck?: SelectedDeck;
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
  preSelectedDeck,
  leadingControl,
  onStart,
}: OfflinePlaySetupProps) {
  return (
    <div className="h-full min-h-0">
      <DeckVsSelector
        preSelectedDeckId={preSelectedDeckId}
        preSelectedHubDeckId={preSelectedHubDeckId}
        preSelectedDeck={preSelectedDeck}
        leadingControl={leadingControl}
        onStart={onStart}
      />
    </div>
  );
}
