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
    <section className="grid min-h-[clamp(22rem,42dvh,28rem)] overflow-hidden rounded-2xl border border-primary/25 bg-card/85 shadow-xl backdrop-blur-md sm:grid-cols-[minmax(15rem,0.9fr)_minmax(18rem,1.1fr)]">
      <div className="flex flex-col justify-center p-5 sm:p-6 lg:p-8">
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
          Multiplayer
        </span>
        <h2 className="mt-2 font-serif text-3xl font-light leading-tight lg:text-4xl">
          Pull up a chair.
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
          Join an official hosted engine for a quick match, or create a custom table for your group.
        </p>

        <Button size="lg" onClick={onSetUp} disabled={disabled} className="mt-5 w-full sm:w-fit">
          <Plus /> Set up a table
        </Button>

        <div className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-background/50 p-3">
            <span className="flex items-center gap-2 font-medium">
              <Cloud className="h-4 w-4 text-primary" /> Hosted
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {hostedTableCount > 0
                ? `${hostedTableCount} ${hostedTableCount === 1 ? "table" : "tables"} ready`
                : "No capacity available"}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/50 p-3">
            <span className="flex items-center gap-2 font-medium">
              <Users className="h-4 w-4 text-primary" /> From players
            </span>
            <p className="mt-1 text-xs text-muted-foreground">
              {playerTableCount > 0
                ? `${playerTableCount} ${playerTableCount === 1 ? "table" : "tables"} open`
                : "No tables waiting right now"}
            </p>
          </div>
        </div>
      </div>

      <div className="relative flex min-h-56 items-center justify-center border-t border-border/60 bg-primary/[0.04] p-5 sm:border-l sm:border-t-0 sm:p-6 lg:p-8">
        <div className="absolute inset-x-8 top-8 h-24 rounded-full bg-primary/10 blur-3xl" />
        <OpenTableSeats
          players={[]}
          maxPlayers={4}
          size="room"
          className="max-w-xl"
          centerContent={
            <span className="flex flex-col items-center gap-1">
              <span className="font-serif text-xl font-light text-foreground/90 sm:text-2xl">
                Your next game
              </span>
              <span className="text-xs text-muted-foreground">Hosted or custom</span>
            </span>
          }
        />
      </div>
    </section>
  );
}
