import { Armchair, Loader2, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import { Button } from "@/components/ui/button";
import { useIsShortScreen, useIsTouch } from "@/hooks/useBreakpoints";
import { tableLabel, useMatchmakingStore } from "@/stores/useMatchmakingStore";
interface MultiplayerStartPanelProps {
  disabled: boolean;
  searching: boolean;
  onSetUp: () => void;
  onFindGame?: () => void;
}
export function MultiplayerStartPanel({
  disabled,
  searching,
  onSetUp,
  onFindGame,
}: MultiplayerStartPanelProps) {
  const shortScreen = useIsShortScreen();
  const isTouch = useIsTouch();
  const compact = shortScreen && isTouch;
  const podSizes = useMatchmakingStore((state) => state.podSizes);
  const brackets = useMatchmakingStore((state) => state.brackets);
  const leave = useMatchmakingStore((state) => state.leave);

  const title = searching ? (
    <>
      Finding a match
      <span aria-hidden className="inline-block animate-ellipsis motion-reduce:animate-none">
        ...
      </span>
    </>
  ) : (
    "Pull up a chair."
  );
  const detail = searching
    ? [
        podSizes.map(tableLabel).join(" or "),
        brackets.length > 0
          ? `Bracket ${[...brackets].sort((a, b) => a - b).join(", ")}`
          : "Checking brackets",
      ].join(" · ")
    : null;
  const actions = searching ? (
    <Button
      variant="outline"
      onClick={() =>
        void leave().catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not cancel the search."),
        )
      }
    >
      Cancel search
    </Button>
  ) : (
    <div className="flex flex-col gap-2 sm:flex-row">
      {onFindGame && (
        <Button variant="primary" onClick={onFindGame} disabled={disabled}>
          <Search /> Find a game
        </Button>
      )}
      <Button variant={onFindGame ? "outline" : "primary"} onClick={onSetUp} disabled={disabled}>
        <Plus /> Create a table
      </Button>
    </div>
  );
  if (compact) {
    return (
      <section className="flex min-h-24 flex-wrap items-center justify-between gap-4 rounded-xl border border-border/70 bg-card/80 p-3 shadow-md backdrop-blur-md">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold leading-tight">
            {searching && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {title}
          </h2>
          <p className="mt-1 text-ui-meta text-muted-foreground">
            {detail ?? "Create a table for your group."}
          </p>
        </div>
        {actions}
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
          {searching ? (
            <Loader2 className="hidden text-foreground animate-spin motion-reduce:animate-none sm:block sm:h-12 sm:w-12" />
          ) : (
            <Armchair className="hidden text-foreground sm:mt-2 sm:block sm:h-24 sm:w-24" />
          )}
          <div
            className={cn(
              "flex flex-col items-center gap-3 sm:ml-4 sm:items-start",
              searching && "sm:w-80",
            )}
          >
            <div className="flex flex-col items-center gap-1 sm:items-start">
              <h2 className="font-serif text-xl font-semibold leading-tight sm:text-4xl">
                {title}
              </h2>
              {detail && <p className="text-ui-body text-muted-foreground">{detail}</p>}
            </div>
            {actions}
          </div>
        </div>
      }
    />
  );
}
