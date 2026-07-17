import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import type { Deck } from "@/protocol/deck";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDeck: Deck,
    formatId?: string,
    commanderName?: string,
  ) => void;
}

export function OfflinePlaySetup({ preSelectedDeckId, onStart }: OfflinePlaySetupProps) {
  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <BreweryBackdrop />
      <div className="relative z-10 flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center border-b border-border/60 bg-background/80 px-3 py-2 backdrop-blur-md">
          <Button variant="ghost" size="sm" asChild>
            <Link to={ROUTES.PLAY_OFFLINE}>
              <ArrowLeft className="h-4 w-4" />
              Offline Play
            </Link>
          </Button>
        </div>
        <div className="min-h-0 flex-1">
          <DeckVsSelector preSelectedDeckId={preSelectedDeckId} onStart={onStart} />
        </div>
      </div>
    </div>
  );
}
