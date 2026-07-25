import { Armchair, Plus } from "lucide-react";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { Button } from "@/components/ui/button";

interface MultiplayerStartPanelProps {
  disabled: boolean;
  onSetUp: () => void;
}

export function MultiplayerStartPanel({ disabled, onSetUp }: MultiplayerStartPanelProps) {
  return (
    <OpenTableSeats
      players={[]}
      maxPlayers={4}
      size="room"
      className="mx-auto w-full max-w-xl aspect-[4/3] sm:max-w-4xl sm:aspect-[35/16]"
      centerContent={
        <div className="flex flex-col items-center gap-4 sm:mr-4 sm:flex-row sm:gap-4">
          <Armchair className="hidden text-primary sm:mt-2 sm:block sm:h-24 sm:w-24" />
          <div className="flex flex-col items-center gap-3 sm:ml-4 sm:items-start">
            <h2 className="font-serif text-xl font-light leading-tight sm:text-4xl">
              Pull up a chair.
            </h2>
            <Button size="lg" onClick={onSetUp} disabled={disabled}>
              <Plus /> Set up a table
            </Button>
          </div>
        </div>
      }
    />
  );
}
