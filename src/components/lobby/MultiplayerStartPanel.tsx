import { Armchair, Plus } from "lucide-react";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { Button } from "@/components/ui/button";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";

interface MultiplayerStartPanelProps {
  disabled: boolean;
  onSetUp: () => void;
}

export function MultiplayerStartPanel({ disabled, onSetUp }: MultiplayerStartPanelProps) {
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const compact = shortScreen && isTouch;

  if (compact) {
    return (
      <section className="flex min-h-24 items-center justify-between gap-4 rounded-xl border border-border/70 bg-card/80 p-3 shadow-md backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl font-light leading-tight">Pull up a chair.</h2>
          <p className="mt-1 text-xs text-muted-foreground">Create a table for your group.</p>
        </div>
        <Button
          variant="primary"
          size="lg"
          className="shrink-0 px-4"
          onClick={onSetUp}
          disabled={disabled}
        >
          <Plus /> Set up
        </Button>
      </section>
    );
  }
  return (
    <OpenTableSeats
      players={[]}
      maxPlayers={4}
      size="room"
      ornamental
      className="mx-auto w-full max-w-xl aspect-[4/3] sm:max-w-4xl sm:aspect-[35/16]"
      centerContent={
        <div className="flex flex-col items-center gap-4 sm:mr-4 sm:flex-row sm:gap-4">
          <Armchair className="hidden text-foreground sm:mt-2 sm:block sm:h-24 sm:w-24" />
          <div className="flex flex-col items-center gap-3 sm:ml-4 sm:items-start">
            <h2 className="font-serif text-xl font-light leading-tight sm:text-4xl">
              Pull up a chair.
            </h2>
            <Button variant="primary" size="lg" onClick={onSetUp} disabled={disabled}>
              <Plus /> Set up a table
            </Button>
          </div>
        </div>
      }
    />
  );
}
