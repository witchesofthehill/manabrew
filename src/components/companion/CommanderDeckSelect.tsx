import { useState } from "react";
import { Layers } from "lucide-react";
import { CreateGameDialog } from "@/components/lobby/CreateGameDialog";
import { Button } from "@/components/ui/button";
import type { CompanionCommanderRef } from "@/stores/useCompanionStore.types";
import { commanderSlotsFromDeck } from "./commanderDeck";

const COMMANDER_FORMATS = ["commander", "paupercommander", "brawl"] as const;
const OATHBREAKER_FORMATS = ["oathbreaker"] as const;

type CommanderPicks = [CompanionCommanderRef, CompanionCommanderRef | null];

interface CommanderDeckSelectProps {
  oathbreaker: boolean;
  onChoose: (picks: CommanderPicks) => void;
}

export function CommanderDeckSelect({ oathbreaker, onChoose }: CommanderDeckSelectProps) {
  const [open, setOpen] = useState(false);
  return (
    <CreateGameDialog
      open={open}
      onOpenChange={setOpen}
      mode="lobby"
      forcedFormatId={oathbreaker ? "oathbreaker" : "commander"}
      commanderImport={{
        formats: oathbreaker ? OATHBREAKER_FORMATS : COMMANDER_FORMATS,
        validate: ({ deck, commanderName }) =>
          commanderSlotsFromDeck(deck, oathbreaker, commanderName)
            ? { legal: true, errors: [] }
            : { legal: false, errors: ["Choose a commander from this deck."] },
      }}
      trigger={
        <Button type="button" variant="outline" size="sm">
          <Layers />
          Choose a deck
        </Button>
      }
      onStart={(deck, _formatId, commanderName) => {
        const picks = commanderSlotsFromDeck(deck, oathbreaker, commanderName);
        if (picks) onChoose(picks);
      }}
    />
  );
}
