import { Cloud, Plus, Users } from "lucide-react";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { Button } from "@/components/ui/button";

interface MultiplayerStartPanelProps {
  hostedTableCount: number;
  playerTableCount: number;
  disabled: boolean;
  onSetUp: () => void;
}

export function MultiplayerStartPanel({
  hostedTableCount,
  playerTableCount,
  disabled,
  onSetUp,
}: MultiplayerStartPanelProps) {
  return (
    <section className="grid min-h-44 overflow-hidden rounded-2xl border border-primary/25 bg-card/85 shadow-xl backdrop-blur-md sm:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="flex flex-col justify-center p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-2xl font-light leading-tight">Pull up a chair.</h2>
          <Button size="sm" onClick={onSetUp} disabled={disabled} className="w-full sm:w-auto">
            <Plus /> Set up a table
          </Button>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Join a hosted game or create a custom table.
        </p>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Cloud className="h-3.5 w-3.5 text-primary" />
            {hostedTableCount > 0
              ? `${hostedTableCount} hosted ${hostedTableCount === 1 ? "table" : "tables"} ready`
              : "No hosted capacity"}
          </span>
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-primary" />
            {playerTableCount > 0
              ? `${playerTableCount} player ${playerTableCount === 1 ? "table" : "tables"} open`
              : "No player tables waiting"}
          </span>
        </div>
      </div>

      <div className="relative hidden items-center justify-center border-l border-border/60 bg-primary/[0.04] p-4 sm:flex">
        <div className="absolute inset-x-6 top-6 h-16 rounded-full bg-primary/10 blur-3xl" />
        <OpenTableSeats
          players={[]}
          maxPlayers={4}
          className="max-w-56"
          centerContent={
            <span className="flex flex-col items-center gap-0.5">
              <span className="font-serif text-sm font-light text-foreground/90">
                Your next game
              </span>
              <span className="text-[10px] text-muted-foreground">Hosted or custom</span>
            </span>
          }
        />
      </div>
    </section>
  );
}
