import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { SelectedDeck } from "@/components/lobby/deckSelection.types";
import type { Deck } from "@/protocol/deck";
import type { ReactNode } from "react";
import type { SinglePlayerSetup } from "@/game/singlePlayerSetup";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  preSelectedDeck?: SelectedDeck;
  singlePlayerSetup?: SinglePlayerSetup;
  leadingControl?: ReactNode;
  onStart: (
    playerDeck: Deck,
    opponentDecks: Deck[],
    formatId?: string,
    commanderName?: string,
    setup?: SinglePlayerSetup,
  ) => Promise<boolean>;
}

export function OfflinePlaySetup({
  preSelectedDeckId,
  preSelectedHubDeckId,
  preSelectedDeck,
  singlePlayerSetup,
  leadingControl,
  onStart,
}: OfflinePlaySetupProps) {
  return (
    <div className="h-full min-h-0">
      <DeckVsSelector
        preSelectedDeckId={preSelectedDeckId}
        preSelectedHubDeckId={preSelectedHubDeckId}
        preSelectedDeck={preSelectedDeck}
        singlePlayerSetup={singlePlayerSetup}
        leadingControl={leadingControl}
        onStart={onStart}
      />
    </div>
  );
}
